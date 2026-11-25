"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const version = 12;
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
const graphSchema = fs.readFileSync(path.join(__dirname, "schema-v2.sql"), "utf8");
const runSchema = fs.readFileSync(path.join(__dirname, "schema-v3.sql"), "utf8");
const retrySchema = fs.readFileSync(path.join(__dirname, "schema-v4.sql"), "utf8");
const subgraphSchema = fs.readFileSync(path.join(__dirname, "schema-v5.sql"), "utf8");
const sdlcSchema = fs.readFileSync(path.join(__dirname, "schema-v6.sql"), "utf8");
const stageSchema = fs.readFileSync(path.join(__dirname, "schema-v7.sql"), "utf8");
const deliverySchema = fs.readFileSync(path.join(__dirname, "schema-v8.sql"), "utf8");
const budgetSchema = fs.readFileSync(path.join(__dirname, "schema-v9.sql"), "utf8");
const stagingSchema = fs.readFileSync(path.join(__dirname, "schema-v10.sql"), "utf8");
const scopeSchema = fs.readFileSync(path.join(__dirname, "schema-v11.sql"), "utf8");
const reusableSchema = fs.readFileSync(path.join(__dirname, "schema-v12.sql"), "utf8");

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
    // Rebuild the parent definition table without cascading into pinned versions.
    if (current < 12) db.exec("PRAGMA foreign_keys=OFF");
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
