// DB CLI 어댑터: mysql/mariadb 는 mysql 계열 클라이언트를, oracle 은 sqlplus 를 부른다.
// 비밀번호는 요청으로만 받아 실행 순간에만 쓰고, argv 에도 남기지 않는다(mysql 은 MYSQL_PWD 환경변수).
"use strict";

const { spawn } = require("child_process");

const MAX_ROWS = 500;
const TIMEOUT = 25_000;

const AUTH_RE = /access denied|error 1045|error 1044|ora-01017|invalid username\/password|login failed/i;
const CONN_RE = /can't connect|could not connect|unknown database|error 200[23]|ora-1254[13]|ora-12514|ora-12170|ora-12543|tns:/i;
const DML_RE = /^\s*(insert|update|delete|replace|merge|create|alter|drop|truncate)\b/i;

const classify = (text) => (AUTH_RE.test(text) ? "auth" : CONN_RE.test(text) ? "connect" : "query");
const lastLine = (text) => {
  const lines = String(text || "").replace(/\r\n/g, "\n").trim().split("\n");
  return (lines[lines.length - 1] || "").trim();
};

// CLI 실행: stdin 으로 SQL 을 넣고 stdout/stderr 를 모은다. spawn 실패는 spawnError 로 알린다.
function runCli(cmd, args, input, env) {
  return new Promise((resolve) => {
    let out = "", err = "", settled = false, timer = 0;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child;
    try {
      child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String((e && e.message) || e), spawnError: (e && e.code) || "ENOENT" });
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* 이미 종료 */ }
      finish({ code: -1, out, err: err + "\n시간 초과(25초)" });
    }, TIMEOUT);
    child.on("error", (e) => finish({ code: -1, out, err: String((e && e.message) || e), spawnError: e.code }));
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => finish({ code, out, err }));
    child.stdin.on("error", () => { /* 조기 종료 */ });
    child.stdin.end(input);
  });
}

// --batch --raw 출력: 첫 줄이 머리글, 탭 구분, NULL 은 NULL.
function parseTsv(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (!lines.length) return null;
  const split = (l) => l.split("\t").map((v) => (v === "NULL" ? null : v));
  return { columns: split(lines[0]), rows: lines.slice(1).map(split) };
}

async function runMysql(p, sql) {
  const order = p.type === "mariadb" ? ["mariadb", "mysql"] : ["mysql", "mariadb"];
  const dml = DML_RE.test(sql);
  // DML 은 영향 행 수를 받으려고 같은 세션에서 ROW_COUNT() 를 이어 묻는다.
  const input = dml ? `${sql};\nSELECT ROW_COUNT();\n` : `${sql};\n`;
  const args = ["--batch", "--raw", "--default-character-set=utf8mb4",
    "--host=" + p.host, "--port=" + p.port, "--user=" + p.user];
  if (p.database) args.push("--database=" + p.database);
  for (const bin of order) {
    const r = await runCli(bin, args, input, { MYSQL_PWD: p.password });
    if (r.spawnError) continue;   // 이 클라이언트가 없으면 다음 후보를 본다
    if (r.code !== 0) {
      const text = (String(r.err).trim() || String(r.out).trim() || `exit ${r.code}`).slice(0, 2000);
      return { ok: false, reason: classify(text), error: text };
    }
    if (dml) {
      const n = Number(lastLine(r.out));
      return { ok: true, columns: [], rows: [], total: 0, changes: Number.isFinite(n) ? n : null };
    }
    const table = parseTsv(r.out);
    if (!table) return { ok: true, columns: [], rows: [], total: 0, changes: null };
    return { ok: true, columns: table.columns, rows: table.rows.slice(0, MAX_ROWS),
      total: table.rows.length, truncated: table.rows.length > MAX_ROWS, changes: null };
  }
  return { ok: false, reason: "missing-cli", error: `'${order.join("' 또는 '")}' 실행 파일을 찾을 수 없습니다` };
}

// SQL*Plus 의 MARKUP CSV 출력(따옴표 규칙은 RFC4180 과 같다).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch !== '"') { field += ch; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; } else quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const FB_LINE = /^\s*\d+\s+rows?\s+(selected|updated|created|deleted|inserted|merged)\.?\s*$/i;
const FB_ROWS = /(\d+)\s+rows?\s+(updated|created|deleted|inserted|merged)\b/i;

async function runOracle(p, sql) {
  // Instant Client 는 tnsnames 없이도 붙도록 easy connect 형식을 쓴다.
  const conn = `${p.user}/${p.password}@//${p.host}:${p.port}/${p.database}`;
  const script = [
    "SET PAGESIZE 5000",
    "SET LINESIZE 32767",
    "SET FEEDBACK ON",
    "SET HEADING ON",
    "SET MARKUP CSV ON",
    "SET TRIMSPOOL ON",
    sql.replace(/;\s*$/, "") + ";",
    "EXIT",
  ].join("\n") + "\n";
  const r = await runCli("sqlplus", ["-S", conn], script, {});
  if (r.spawnError) return { ok: false, reason: "missing-cli", error: "'sqlplus' 실행 파일을 찾을 수 없습니다" };
  const out = String(r.out).replace(/\r\n/g, "\n");
  const err = String(r.err || "").trim();
  const all = out + "\n" + err;
  if (r.code !== 0 || /ORA-\d+|SP2-\d+/.test(all)) {
    const text = (err || out).trim() || `exit ${r.code}`;
    return { ok: false, reason: classify(text), error: text.slice(0, 2000) };
  }
  const fb = out.match(FB_ROWS);
  const lines = out.split("\n").filter((l) => !FB_LINE.test(l));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const grid = parseCsv(lines.join("\n")).filter((r) => r.some((v) => v !== ""));
  if (!grid.length) return { ok: true, columns: [], rows: [], total: 0, changes: fb ? Number(fb[1]) : null };
  const columns = grid[0];
  const rows = grid.slice(1);
  return { ok: true, columns, rows: rows.slice(0, MAX_ROWS), total: rows.length,
    truncated: rows.length > MAX_ROWS, changes: null };
}

module.exports = { runCli, runMysql, runOracle };
