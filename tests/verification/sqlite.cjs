"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-v2-sqlite-"));
const file = path.join(directory, "probe.sqlite");
let db;
try {
  db = new DatabaseSync(file);
  db.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY, status TEXT NOT NULL)");
  db.exec("BEGIN; INSERT INTO runs VALUES (1, 'completed'); COMMIT;");
  db.exec("BEGIN; INSERT INTO runs VALUES (2, 'interrupted');");
  db.close();

  db = new DatabaseSync(file);
  const rows = db.prepare("SELECT id, status FROM runs").all();
  assert.deepEqual(rows.map(({ id, status }) => [id, status]), [[1, "completed"]]);
  console.log("SQLite commit and uncommitted transaction recovery passed");
} finally {
  try { db?.close(); } catch (error) {
    if (error.code !== "ERR_INVALID_STATE") throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
