"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ROOT } = require("../config");
// 페이로드 규칙은 정의 저장소와 같이 쓴다(순수 모듈만 끌어온다).
const { profilePayload, field } = require("../engineering/profile-payload");

let db;

function store() {
  if (db) return db;
  const dir = process.env.OMP_MAP_STATE || path.join(ROOT, "data");
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dir, { recursive: true });
  const connection = new DatabaseSync(path.join(dir, "session-harness.sqlite"));
  try {
    connection.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profile_history (
        id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id, version)
      );
      CREATE TRIGGER IF NOT EXISTS archive_profile_update BEFORE UPDATE ON profiles
      BEGIN INSERT INTO profile_history VALUES (OLD.id, OLD.version, OLD.payload); END;
      CREATE TRIGGER IF NOT EXISTS archive_profile_delete BEFORE DELETE ON profiles
      BEGIN INSERT INTO profile_history VALUES (OLD.id, OLD.version, OLD.payload); END;
      CREATE TABLE IF NOT EXISTS assignments (
        session TEXT PRIMARY KEY, payload TEXT NOT NULL
      );
    `);
  } catch (error) {
    connection.close();
    throw error;
  }
  db = connection;
  return db;
}

const sessionKey = (node) => process.platform === "win32" ? path.normalize(node).toLowerCase() : path.normalize(node);
const unpack = ({ id, version, payload }) => ({ id, version, ...JSON.parse(payload) });

function legacyList() {
  return store().prepare("SELECT id, version, payload FROM profiles").all().map(unpack)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function legacyGet(id, version) {
  const row = store().prepare("SELECT id, version, payload FROM profiles WHERE id=? AND version=?").get(id, version);
  if (!row) throw new Error("하네스가 변경되었거나 삭제되었습니다. 목록을 다시 열어 주세요.");
  return unpack(row);
}

function legacyPinned(id, version) {
  const row = store().prepare(`SELECT id, version, payload FROM profiles WHERE id=? AND version=?
    UNION ALL SELECT id, version, payload FROM profile_history WHERE id=? AND version=?`).get(id, version, id, version);
  return row && unpack(row);
}

function legacySave(input) {
  const payload = profilePayload(input);
  const body = JSON.stringify(payload);
  const connection = store();
  if (!input.id) {
    const id = randomUUID();
    connection.prepare("INSERT INTO profiles VALUES (?, 1, ?)").run(id, body);
    return { id, version: 1, ...payload };
  }
  const id = field(input.id, 36, "하네스 ID"), version = input.version;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("하네스 버전을 확인해 주세요.");
  const write = connection.prepare("UPDATE profiles SET version=version+1, payload=? WHERE id=? AND version=?")
    .run(body, id, version);
  if (!write.changes) throw new Error("하네스가 변경되었거나 삭제되었습니다. 목록을 다시 열어 주세요.");
  return { id, version: version + 1, ...payload };
}

function legacyRemove(id, version) {
  if (typeof id !== "string" || !Number.isSafeInteger(version)) throw new Error("하네스 버전을 확인해 주세요.");
  if (!store().prepare("DELETE FROM profiles WHERE id=? AND version=?").run(id, version).changes) {
    throw new Error("하네스가 변경되었거나 삭제되었습니다. 목록을 다시 열어 주세요.");
  }
}

function assign(node, profile) {
  store().prepare("INSERT INTO assignments VALUES (?, ?)").run(sessionKey(node), JSON.stringify(profile));
}

function assigned(node, adapter) {
  const dir = process.env.OMP_MAP_STATE || path.join(ROOT, "data");
  if (!db && !fs.existsSync(path.join(dir, "session-harness.sqlite"))) return;
  const row = store().prepare("SELECT payload FROM assignments WHERE session=?").get(sessionKey(node));
  const profile = row && JSON.parse(row.payload);
  if (profile?.adapter === adapter) return profile;
}

function systemPrompt(profile) {
  if (!profile) return "";
  return [profile.role && "Role: " + profile.role, profile.instructions].filter(Boolean).join("\n\n");
}

function close() {
  db?.close();
  db = undefined;
}

// 프로필 정의(list·get·pinned·save·remove)를 어디에 둘지 고른다.
// 엔지니어링 DB가 열리면(데스크톱) 정의 저장소(definition kind='profile', 개인·팀 범위)를 쓰고,
// 웹 모드에서는 이 파일의 session-harness.sqlite 를 그대로 쓴다. 세션 배정(assignments)은 늘 이 파일에 남는다.
const legacy = { list: legacyList, get: legacyGet, pinned: legacyPinned, save: legacySave, remove: legacyRemove };
let backend = legacy;

function useDefinitions(next) {
  backend = next || legacy;
}

// 이전 저장소를 읽기만 한다(가져오기용). 파일이 없으면 null.
function legacyRows() {
  const dir = process.env.OMP_MAP_STATE || path.join(ROOT, "data");
  if (!db && !fs.existsSync(path.join(dir, "session-harness.sqlite"))) return null;
  const connection = store();
  return {
    file: path.join(dir, "session-harness.sqlite"),
    current: connection.prepare("SELECT id, version, payload FROM profiles").all(),
    history: connection.prepare("SELECT id, version, payload FROM profile_history").all(),
  };
}

module.exports = {
  close, assign, assigned, systemPrompt, useDefinitions, legacyRows, legacy,
  list: () => backend.list(),
  get: (id, version) => backend.get(id, version),
  pinned: (id, version) => backend.pinned(id, version),
  save: (input) => backend.save(input),
  remove: (id, version) => backend.remove(id, version),
};
