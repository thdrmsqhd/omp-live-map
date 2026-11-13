// SQLite 어댑터: Node 22.5+ 내장 node:sqlite 를 우선 쓰고, 없으면 설치된 sqlite3 CLI 로 대신한다.
"use strict";

const fs = require("fs");
const path = require("path");
const { runCli } = require("./db-cli");

const MAX_ROWS = 500;

let sqlite = null;
try { sqlite = require("node:sqlite"); } catch { sqlite = null; }

const errText = (e) => String((e && e.message) || e);

// JSON 으로 보낼 수 없는 값을 문자열로 바꾼다(BigInt·BLOB·객체).
const cell = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return String(v);
  if (v instanceof Uint8Array) return `<blob ${v.length}B>`;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
};

function viaBuiltin(full, sql) {
  let db;
  try { db = new sqlite.DatabaseSync(full); } catch (e) { return { ok: false, reason: "connect", error: errText(e) }; }
  try {
    const stmt = db.prepare(sql);
    stmt.setReadBigInts(true);
    const columns = stmt.columns().map((c) => c.name);
    // 결과 집합이 없으면 변경 행 수를 돌려준다(INSERT·UPDATE·DELETE).
    if (!columns.length) return { ok: true, columns: [], rows: [], total: 0, changes: Number(stmt.run().changes) };
    const rows = [];
    for (const row of stmt.iterate()) {
      rows.push(columns.map((c) => cell(row[c])));
      if (rows.length > MAX_ROWS) break;
    }
    return { ok: true, columns, rows: rows.slice(0, MAX_ROWS), total: rows.length,
      truncated: rows.length > MAX_ROWS, changes: null };
  } catch (e) {
    return { ok: false, reason: "query", error: errText(e) };
  } finally {
    try { db.close(); } catch { /* 이미 닫힘 */ }
  }
}

// sqlite3 CLI 는 -json 으로 행 배열을 준다(3.33+). 변경 행 수는 출력되지 않아 null 이 된다.
async function viaCli(full, sql) {
  const r = await runCli("sqlite3", ["-json", full], sql.replace(/;\s*$/, "") + ";\n", {});
  if (r.spawnError) return { ok: false, reason: "missing-cli", error: "'sqlite3' 실행 파일을 찾을 수 없습니다" };
  const text = String(r.out).trim();
  if (r.code !== 0) {
    const msg = (String(r.err).trim() || text || `exit ${r.code}`).slice(0, 2000);
    return { ok: false, reason: /unable to open/i.test(msg) ? "connect" : "query", error: msg };
  }
  if (!text) return { ok: true, columns: [], rows: [], total: 0, changes: null };
  let list;
  try { list = JSON.parse(text); } catch (e) { return { ok: false, reason: "query", error: "결과 해석 실패: " + errText(e) }; }
  if (!Array.isArray(list) || !list.length) return { ok: true, columns: [], rows: [], total: 0, changes: null };
  const columns = Object.keys(list[0]);
  const rows = list.map((row) => columns.map((c) => cell(row[c])));
  return { ok: true, columns, rows: rows.slice(0, MAX_ROWS), total: rows.length,
    truncated: rows.length > MAX_ROWS, changes: null };
}

function runSqlite(p, sql) {
  const full = path.resolve(p.path);
  if (!fs.existsSync(full)) return { ok: false, reason: "connect", error: "파일 없음: " + full };
  return sqlite ? viaBuiltin(full, sql) : viaCli(full, sql);
}

module.exports = { runSqlite };
