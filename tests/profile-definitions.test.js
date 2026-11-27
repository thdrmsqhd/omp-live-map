"use strict";

// PR-13: 세션 프로필을 정의 범위 체계로 옮긴다. v12 → v13 이전, 이전 저장소 가져오기, 개인·팀 범위 저장을 확인한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { profileDefinitions, importLegacyProfiles } = require("../server/engineering/profile-definitions");

const SCHEMA = path.resolve(__dirname, "../server/engineering");

// v12 까지의 스키마를 그대로 쌓아 '이전 앱이 남긴 DB'를 만든다.
function v12Database(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=OFF");
  for (const name of ["schema.sql", ...Array.from({ length: 11 }, (_, i) => `schema-v${i + 2}.sql`)]) {
    db.exec(fs.readFileSync(path.join(SCHEMA, name), "utf8"));
  }
  db.exec("PRAGMA user_version=12; PRAGMA foreign_keys=ON");
  return db;
}

function legacyStore(directory) {
  process.env.OMP_MAP_STATE = directory;
  const profiles = require("../server/harness/session-profiles");
  profiles.close();
  profiles.useDefinitions(null);
  return profiles;
}

test("v12 → v13 keeps definitions, backs the old file up and accepts profile definitions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-v13-"));
  const file = path.join(directory, "engineering.sqlite");
  try {
    const old = v12Database(file);
    old.prepare("INSERT INTO definition(id,scope,project,team,kind,name,version) VALUES ('m','personal',NULL,NULL,'model','m',1)").run();
    old.prepare("INSERT INTO definition_version VALUES ('m',1,?)").run(JSON.stringify({ name: "m", provider: "p", model: "x", reasoning: "" }));
    old.close();
    const db = openDatabase(file);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 13);
      assert.ok(fs.existsSync(file + ".v12.bak"), "the v12 file is copied before migrating");
      const backup = new DatabaseSync(file + ".v12.bak", { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 12);
      backup.close();
      assert.equal(db.prepare("SELECT name FROM definition WHERE id='m'").get().name, "m");
      assert.equal(db.prepare("SELECT count(*) AS n FROM definition_version WHERE id='m'").get().n, 1, "versions survive the rebuild");
      assert.equal(db.prepare("PRAGMA foreign_key_check").get(), undefined);
      const saved = catalog(db).saveDefinition({ scope: "personal", kind: "profile",
        payload: { name: "검토", adapter: "claude", model: "claude-sonnet-4-5", role: "리뷰", instructions: "" } });
      assert.equal(saved.kind, "profile");
      assert.equal(catalog(db).definitions(null, "personal").some(({ kind }) => kind === "profile"), false,
        "harness/model lists do not show profiles");
    } finally { db.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy profiles move once with ids, versions and deleted history; saves use personal and team scope", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-profiles-"));
  const original = process.env.OMP_MAP_STATE;
  const profiles = legacyStore(path.join(directory, "state"));
  try {
    const kept = profiles.save({ name: "작성자", adapter: "claude", model: "claude-sonnet-4-5", role: "작성", instructions: "v1" });
    const edited = profiles.save({ ...kept, instructions: "v2" });
    const gone = profiles.save({ name: "폐기", adapter: "omp", model: "m", provider: "p", role: "", instructions: "" });
    profiles.remove(gone.id, gone.version);
    const dup = profiles.save({ name: "작성자", adapter: "omp", model: "", role: "", instructions: "" });
    assert.equal(edited.version, 2);

    const db = openDatabase(path.join(directory, "engineering.sqlite"));
    try {
      const definitions = catalog(db);
      assert.equal(importLegacyProfiles(db, profiles.legacyRows()), 3);
      assert.equal(importLegacyProfiles(db, profiles.legacyRows()), 0, "import runs once");
      const store = profileDefinitions(db, definitions);
      profiles.useDefinitions(store);

      const listed = profiles.list();
      assert.deepEqual(listed.map(({ name }) => name).sort(), ["작성자", "작성자 (2)"], "deleted profiles are hidden, duplicate names get a suffix");
      assert.equal(profiles.pinned(kept.id, 1).instructions, "v1", "old pinned versions still resolve");
      assert.equal(profiles.pinned(kept.id, 2).instructions, "v2");
      assert.equal(profiles.pinned(gone.id, 1).name, "폐기", "workflow pins to deleted profiles still resolve");
      assert.equal(profiles.get(kept.id, 2).scope, "personal");
      assert.throws(() => profiles.get(kept.id, 1), /변경되었거나/);
      assert.throws(() => profiles.get(gone.id, 1), /변경되었거나/);
      assert.ok(profiles.get(dup.id, 1));

      const next = profiles.save({ ...profiles.get(kept.id, 2), instructions: "v3" });
      assert.equal(next.version, 3);
      assert.equal(next.id, kept.id);
      assert.throws(() => profiles.save({ ...next, version: 2 }), /변경되었거나/);
      assert.throws(() => profiles.save({ name: "작성자", adapter: "claude", model: "", role: "", instructions: "" }), /같은 이름/);

      definitions.saveTeam("platform");
      const team = profiles.save({ name: "팀 리뷰어", adapter: "claude", model: "", role: "리뷰", instructions: "", scope: "team", team: "platform" });
      assert.equal(team.scope, "team");
      assert.equal(team.team, "platform");
      assert.throws(() => profiles.save({ name: "x", adapter: "claude", model: "", role: "", instructions: "", scope: "team", team: "없음" }), /팀을 찾을 수 없/);

      profiles.remove(team.id, team.version);
      assert.equal(profiles.list().some(({ id }) => id === team.id), false);
      assert.equal(profiles.pinned(team.id, 1).name, "팀 리뷰어");
      assert.ok(profiles.save({ name: "팀 리뷰어", adapter: "claude", model: "", role: "", instructions: "" }), "a retired name can be reused");
      assert.throws(() => definitions.remove(kept.id), /retired/);
      assert.equal(db.prepare("PRAGMA foreign_key_check").get(), undefined);
    } finally {
      profiles.useDefinitions(null);
      db.close();
    }
  } finally {
    profiles.close();
    if (original === undefined) delete process.env.OMP_MAP_STATE; else process.env.OMP_MAP_STATE = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
