"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ui = path.join(__dirname, "..", "ui");
const scripts = [...fs.readFileSync(path.join(ui, "index.html"), "utf8").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test("app.js starts only after every later script has run", () => {
  const app = fs.readFileSync(path.join(ui, "js", "app.js"), "utf8");
  // app.js 는 조립 계층이라 마지막 일반 스크립트다. 그래도 boot()는 DOMContentLoaded 뒤에 시작한다
  // (첫 스냅샷이 다른 스크립트보다 먼저 도착하면 wfMap 이 없어 "시작 실패"가 났다).
  assert.equal(scripts.at(-1), "js/app.js");
  assert.match(app, /DOMContentLoaded/);
  assert.doesNotMatch(app, /^boot\(\)/m);
});