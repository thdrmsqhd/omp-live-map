"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ui = path.join(__dirname, "..", "ui");
const scripts = [...fs.readFileSync(path.join(ui, "index.html"), "utf8").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test("app.js starts only after every later script has run", () => {
  const app = fs.readFileSync(path.join(ui, "js", "app.js"), "utf8");
  // 첫 스냅샷이 workflow-map.js 보다 먼저 도착하면 wfMap 이 없어 "시작 실패"가 났다.
  assert.ok(scripts.indexOf("js/view/workflow-map.js") > scripts.indexOf("js/app.js"), "this guard is only needed while app.js loads first");
  assert.match(app, /DOMContentLoaded/);
  assert.doesNotMatch(app, /^boot\(\)/m);
});