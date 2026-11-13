// DB 공용: 프로필 정규화·검증·디스패치. SQLite 는 node:sqlite, 나머지는 설치된 CLI 를 쓴다(npm 의존성 없음).
"use strict";

const { runSqlite } = require("./db-sqlite");
const { runMysql, runOracle } = require("./db-cli");

const TYPES = new Set(["sqlite", "mysql", "mariadb", "oracle"]);
const PORTS = { mysql: "3306", mariadb: "3306", oracle: "1521" };
const HINTS = {
  sqlite: "sqlite3 CLI 를 PATH 에 설치하세요(scoop install sqlite).",
  mysql: "mysql CLI 를 PATH 에 설치하세요(mysql-client).",
  mariadb: "mariadb(또는 mysql) CLI 를 PATH 에 설치하세요.",
  oracle: "sqlplus(SQL*Plus) 를 PATH 에 설치하세요(Instant Client).",
};

// 서버로 오는 연결 프로필. 비밀번호는 요청마다 받고 어디에도 저장하지 않는다.
function profileOf(p) {
  const type = String(p.type || "sqlite").toLowerCase();
  return {
    type: TYPES.has(type) ? type : "sqlite",
    host: String(p.host || "127.0.0.1").trim(),
    port: String(p.port || PORTS[type] || "").trim(),
    database: String(p.database || "").trim(),
    user: String(p.user || "").trim(),
    password: String(p.password || ""),
    path: String(p.path || "").trim(),
  };
}

// 따옴표 밖 세미콜론이 문장 끝 하나뿐인지 본다. 여러 문장이 한 번에 실행되는 것을 막는다.
function multiStatement(sql) {
  let semis = 0, quote = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch !== quote) continue;
      if (quote !== "]" && sql[i + 1] === quote) { i++; continue; }   // '' "" `` 는 이스케이프
      quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "[") quote = "]";
    else if (ch === ";") semis++;
  }
  return semis > 1 || (semis === 1 && !/;\s*$/.test(sql));
}

// 프로필 자체가 실행에 필요한 값을 갖췄는지. 없으면 사용자에게 보여 줄 사유를 돌려준다.
function missingOf(p) {
  if (p.type === "sqlite") return p.path ? "" : "SQLite 파일 경로가 비었습니다";
  if (!p.host) return "host 가 비었습니다";
  if (!p.user) return "user 가 비었습니다";
  if (p.type === "oracle" && !p.database) return "service/SID 가 비었습니다";
  if ((p.type === "mysql" || p.type === "mariadb") && !p.database) return "database 가 비었습니다";
  return "";
}

async function queryDb(profile, sqlText) {
  const at = Date.now();
  const p = profileOf(profile);
  const sql = String(sqlText || "").trim();
  const done = (body) => ({ ms: Date.now() - at, ...body });
  if (!sql) return done({ ok: false, reason: "input", error: "SQL 이 비었습니다" });
  if (multiStatement(sql)) return done({ ok: false, reason: "input", error: "한 문장만 실행할 수 있습니다" });
  const missing = missingOf(p);
  if (missing) return done({ ok: false, reason: "profile", error: missing });

  let out;
  try {
    out = p.type === "sqlite"
      ? await runSqlite(p, sql)
      : p.type === "oracle"
        ? await runOracle(p, sql)
        : await runMysql(p, sql);
  } catch (e) {
    out = { ok: false, reason: "query", error: String((e && e.message) || e) };
  }
  // 실행 파일이 없으면 어떤 파일을 설치해야 하는지까지 알려 준다.
  if (out && out.reason === "missing-cli" && !out.hint) out.hint = HINTS[p.type];
  return done(out);
}

module.exports = { queryDb, profileOf };
