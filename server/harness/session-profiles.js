"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ROOT } = require("../config");
// 실행기 목록은 순수 데이터 모듈 하나만 공유한다(다른 engineering 모듈은 끌어오지 않는다).
const { isAdapter } = require("../engineering/adapter-registry");

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

function list() {
  return store().prepare("SELECT id, version, payload FROM profiles").all().map(unpack)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function get(id, version) {
  const row = store().prepare("SELECT id, version, payload FROM profiles WHERE id=? AND version=?").get(id, version);
  if (!row) throw new Error("하네스가 변경되었거나 삭제되었습니다. 목록을 다시 열어 주세요.");
  return unpack(row);
}

function pinned(id, version) {
  const row = store().prepare(`SELECT id, version, payload FROM profiles WHERE id=? AND version=?
    UNION ALL SELECT id, version, payload FROM profile_history WHERE id=? AND version=?`).get(id, version, id, version);
  return row && unpack(row);
}

function field(value, limit, label) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > limit || value.includes("\0")) {
    throw new Error(label + " 형식을 확인해 주세요.");
  }
  return value.trim();
}

function save(input) {
  const name = field(input.name, 120, "이름");
  const role = field(input.role, 240, "역할");
  const instructions = field(input.instructions, 12000, "작업 지시");
  const adapter = input.adapter;
  const model = field(input.model, 160, "모델");
  const provider = adapter === "omp" && model ? field(input.provider, 80, "모델 제공자") : "";
  if (!name || !isAdapter(adapter)) throw new Error("이름과 실행기를 입력해 주세요.");
  if (adapter === "omp" && model && !provider) throw new Error("OMP 모델을 지정하려면 모델 제공자도 입력해 주세요.");
  if (adapter === "claude" && model && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(model)) {
    throw new Error("Claude 모델 ID 형식을 확인해 주세요.");
  }
  const payload = { name, role, instructions, adapter, model, provider };
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

function remove(id, version) {
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

module.exports = { close, list, get, pinned, save, remove, assign, assigned, systemPrompt };
