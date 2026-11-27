"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const version = 15;
const schema = fs.readFileSync(path.join(__dirname, "../engineering/schema.sql"), "utf8");
const graphSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v2.sql"), "utf8");
const runSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v3.sql"), "utf8");
const retrySchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v4.sql"), "utf8");
const subgraphSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v5.sql"), "utf8");
const sdlcSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v6.sql"), "utf8");
const stageSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v7.sql"), "utf8");
const deliverySchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v8.sql"), "utf8");
const budgetSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v9.sql"), "utf8");
const stagingSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v10.sql"), "utf8");
const scopeSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v11.sql"), "utf8");
const reusableSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v12.sql"), "utf8");
const profileSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v13.sql"), "utf8");
const workflowScopeSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v14.sql"), "utf8");
const boardSchema = fs.readFileSync(path.join(__dirname, "../engineering/schema-v15.sql"), "utf8");

function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function openDatabase(file) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL");
    const current = db.prepare("PRAGMA user_version").get().user_version;
    // 스키마를 올리기 전에 지금 파일을 그대로 떠 둔다. 새 버전은 구버전 앱이 열지 못하므로 되돌릴 때 이 파일을 쓴다.
    if (current > 0 && current < version) {
      const saved = file + ".v" + current + ".bak";
      if (!fs.existsSync(saved)) backup(db, saved);
    }
    // Rebuild the parent definition table without cascading into pinned versions.
    if (current < 15) db.exec("PRAGMA foreign_keys=OFF");
    transaction(db, () => {
      const current = db.prepare("PRAGMA user_version").get().user_version;
      if (current > version) throw new Error("Unsupported engineering database version");
      if (current < 1) db.exec(schema);
      if (current < 2) db.exec(graphSchema);
      if (current < 3) db.exec(runSchema);
      if (current < 4) db.exec(retrySchema);
      if (current < 5) db.exec(subgraphSchema);
      if (current < 6) db.exec(sdlcSchema);
      if (current < 7) db.exec(stageSchema);
      if (current < 8) db.exec(deliverySchema);
      if (current < 9) db.exec(budgetSchema);
      if (current < 10) db.exec(stagingSchema);
      if (current < 11) db.exec(scopeSchema);
      if (current < 12) {
        db.exec(reusableSchema);
        if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("Invalid scoped definition migration");
        db.exec("PRAGMA user_version=12");
      }
      if (current < 13) {
        db.exec(profileSchema);
        if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("Invalid profile definition migration");
        db.exec("PRAGMA user_version=13");
      }
      if (current < 14) {
        db.exec(workflowScopeSchema);
        if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("Invalid workflow scope migration");
        db.exec("PRAGMA user_version=14");
      }
      if (current < 15) {
        db.exec(boardSchema);
        if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("Invalid board migration");
        db.exec("PRAGMA user_version=15");
      }
    });
    db.exec("PRAGMA foreign_keys=ON");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function backup(db, destination) {
  const temporary = destination + "." + randomUUID() + ".tmp";
  try {
    db.prepare("VACUUM INTO ?").run(temporary);
    fs.linkSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { openDatabase, transaction, backup };
