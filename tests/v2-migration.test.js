"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { migrateFromV2 } = require("../server/engineering/v2-migration");
const { openDatabase } = require("../server/infrastructure/sqlite");

test("V3 snapshots live V2 SQLite data and preserves existing V3 state on a later launch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-v2-migrate-"));
  const source = path.join(root, "v2"), target = path.join(root, "v3");
  fs.mkdirSync(path.join(source, "legacy-state"), { recursive: true });
  fs.writeFileSync(path.join(source, "legacy-state", "claude-models.json"), '{"model":"v2"}');
  fs.writeFileSync(path.join(source, "anthropic-key.dpapi"), "fixture");
  const old = new DatabaseSync(path.join(source, "engineering.sqlite"));
  let next;
  try {
    old.exec(fs.readFileSync(path.resolve(__dirname, "../server/engineering/schema.sql"), "utf8"));
    old.exec("PRAGMA user_version=1; PRAGMA journal_mode=WAL");
    old.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("saved", root, "V2 project", "main");
    assert.equal(migrateFromV2(source, target), true);
    assert.equal(fs.readFileSync(path.join(target, "legacy-state", "claude-models.json"), "utf8"), '{"model":"v2"}');
    assert.equal(fs.existsSync(path.join(target, "anthropic-key.dpapi")), false);
    next = openDatabase(path.join(target, "engineering.sqlite"));
    assert.equal(next.prepare("SELECT name FROM project WHERE id='saved'").get().name, "V2 project");
    next.prepare("UPDATE project SET name='V3 project' WHERE id='saved'").run();
    assert.equal(migrateFromV2(source, target), false);
    assert.equal(next.prepare("SELECT name FROM project WHERE id='saved'").get().name, "V3 project");
    assert.equal(old.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(old.prepare("SELECT name FROM project WHERE id='saved'").get().name, "V2 project");
  } finally {
    next?.close();
    old.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
