"use strict";

// 관제의 새 대화형 세션(＋ 세션)에 하네스를 입힌다. 하네스 정의는 Engineering 정의 저장소(catalog)에 있고,
// 세션을 띄울 때 고른 하네스의 역할·지시·모델을 세션마다 한 번 적어 둔다(assignments). 하네스를 나중에 고쳐도
// 이미 띄운 세션은 띄울 때의 설정을 계속 쓴다. 파일 이름(session-harness.sqlite)은 예전 저장소와 같다.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("../config");

let db;
let source = null;
const STALE = "하네스가 변경되었거나 삭제되었습니다. 목록을 다시 열어 주세요.";

const stateDir = () => process.env.OMP_MAP_STATE || path.join(ROOT, "data");
const file = () => path.join(stateDir(), "session-harness.sqlite");

function store() {
  if (db) return db;
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(stateDir(), { recursive: true });
  const connection = new DatabaseSync(file());
  try {
    connection.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS assignments (session TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  } catch (error) {
    connection.close();
    throw error;
  }
  db = connection;
  return db;
}

const sessionKey = (node) => process.platform === "win32" ? path.normalize(node).toLowerCase() : path.normalize(node);

function assign(node, harness) {
  store().prepare("INSERT INTO assignments VALUES (?, ?)").run(sessionKey(node), JSON.stringify(harness));
}

function assigned(node, adapter) {
  if (!db && !fs.existsSync(file())) return;
  const row = store().prepare("SELECT payload FROM assignments WHERE session=?").get(sessionKey(node));
  const harness = row && JSON.parse(row.payload);
  if (harness?.adapter === adapter) return harness;
}

function systemPrompt(harness) {
  if (!harness) return "";
  return [harness.role && "Role: " + harness.role, harness.instructions].filter(Boolean).join("\n\n");
}

// Engineering 정의 저장소를 쓰는 함수(호출할 때 DB 를 연다). engineering-routes.js 가 연결한다.
function useCatalog(provider) {
  source = provider || null;
}

// 하네스 정의를 세션에 쓸 모양으로 바꾼다: 실행기·역할·지시 + 연결된 모델 정의의 모델 ID·공급자.
function sessionPayload(definitions, record) {
  const model = definitions.dependency(record);
  const { name, adapter, role, instructions } = record.payload;
  return { id: record.id, version: record.version, name, adapter, role, instructions: instructions ?? "",
    scope: record.scope, team: record.team ?? null, project: record.project ?? null,
    model: model?.payload.model ?? "", provider: model?.payload.provider ?? "", modelName: model?.name ?? "" };
}

function list() {
  if (!source) return [];
  const definitions = source();
  return definitions.harnesses().map((record) => sessionPayload(definitions, record));
}

// 화면이 본 (id, 버전)이 지금 최신일 때만 쓴다. 그 사이 바뀌었으면 다시 고르게 한다.
function resolve(ref) {
  if (!ref || typeof ref.id !== "string" || !Number.isSafeInteger(ref.version)) throw new Error("하네스 버전을 확인해 주세요.");
  if (!source) throw new Error(STALE);
  const definitions = source();
  let record;
  try { record = definitions.versionOf(ref.id); } catch { throw new Error(STALE); }
  if (record.kind !== "harness" || record.version !== ref.version) throw new Error(STALE);
  return sessionPayload(definitions, record);
}

// 예전 세션 프로필 저장소(profiles·profile_history 표)를 읽기만 한다. 합치기(harness-merge.js)가 한 번 쓴다. 없으면 null.
function legacyRows() {
  if (!db && !fs.existsSync(file())) return null;
  const connection = store();
  const has = (name) => connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!has("profiles")) return null;
  return {
    file: file(),
    current: connection.prepare("SELECT id, version, payload FROM profiles").all(),
    history: has("profile_history") ? connection.prepare("SELECT id, version, payload FROM profile_history").all() : [],
  };
}

function close() {
  db?.close();
  db = undefined;
}

module.exports = { assign, assigned, systemPrompt, useCatalog, list, resolve, legacyRows, close };
