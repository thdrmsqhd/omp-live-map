"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { backup } = require("../infrastructure/sqlite");

function migrateFromV2(source, destination) {
  const legacy = path.resolve(source), next = path.resolve(destination);
  const oldDatabase = path.join(legacy, "engineering.sqlite");
  const database = path.join(next, "engineering.sqlite");
  if (legacy === next || !fs.existsSync(legacy) || fs.existsSync(database)) return false;
  if (fs.existsSync(next) && fs.realpathSync(next) === fs.realpathSync(legacy)) return false;
  const marker = path.join(next, "v2-imported.json");
  if (fs.existsSync(marker)) return false;
  fs.mkdirSync(next, { recursive: true, mode: 0o700 });
  for (const name of ["clear-lineage.json", "claude-models.json"]) {
    const old = path.join(legacy, "legacy-state", name);
    const target = path.join(next, "legacy-state", name);
    if (!fs.existsSync(old) || fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(old, target, fs.constants.COPYFILE_EXCL);
  }
  if (fs.existsSync(oldDatabase)) {
    const { DatabaseSync } = require("node:sqlite");
    const original = new DatabaseSync(oldDatabase, { readOnly: true });
    try {
      original.exec("PRAGMA busy_timeout=3000");
      backup(original, database);
    } finally {
      original.close();
    }
  }
  fs.writeFileSync(marker, JSON.stringify({ importedAt: new Date().toISOString(), sqlite: fs.existsSync(database) }),
    { mode: 0o600, flag: "wx" });
  return true;
}

module.exports = { migrateFromV2 };
