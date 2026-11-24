"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const version = 4;
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
const graphSchema = fs.readFileSync(path.join(__dirname, "schema-v2.sql"), "utf8");
const runSchema = fs.readFileSync(path.join(__dirname, "schema-v3.sql"), "utf8");
const retrySchema = fs.readFileSync(path.join(__dirname, "schema-v4.sql"), "utf8");

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
    transaction(db, () => {
      const current = db.prepare("PRAGMA user_version").get().user_version;
      if (current > version) throw new Error("Unsupported engineering database version");
      if (current < 1) db.exec(schema);
      if (current < 2) db.exec(graphSchema);
      if (current < 3) db.exec(runSchema);
      if (current < 4) db.exec(retrySchema + "; PRAGMA user_version=4");
    });
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
