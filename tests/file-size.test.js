"use strict";

// 파일 하나는 200줄 미만을 원칙으로 하고, 500줄은 넘기지 않는다.
// 이미 500줄을 넘은 파일은 아래 상한보다 커지면 실패한다. 파일을 나눌 때 상한을 낮추거나 항목을 지운다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LIMIT = 500;
const LEGACY = {
  "ui/js/studio.js": 947,
  "ui/js/view/workflow-map.js": 643,
};

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== "vendor") walk(rel); }
      else if (/\.(c?js|ts)$/.test(entry.name)) out.push(rel);
    }
  };
  for (const dir of ["server", "ui", "desktop", "extension"]) walk(dir);
  return out;
}

test("source files stay under the size limit and legacy files do not grow", () => {
  const problems = [];
  for (const file of sources()) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").length - 1;
    const cap = LEGACY[file] ?? LIMIT;
    if (lines > cap) problems.push(`${file}: ${lines} > ${cap}`);
  }
  assert.deepEqual(problems, []);
});
