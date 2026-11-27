"use strict";

// 안내 문서(docs/reference, docs/guide, docs/development.md, AGENTS.md)가 가리키는 코드 경로가 실제로 있는지 확인한다.
// 문서가 코드와 어긋나면 사람과 에이전트가 틀린 지도를 보게 된다. 과거 기록(docs/analysis, docs/plans, 릴리스 노트)은 대상이 아니다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ROOTS = ["server/", "ui/", "tests/", "desktop/", "extension/", "docs/", ".github/"];

function guides() {
  const files = [path.join(ROOT, "docs/development.md")];
  for (const dir of ["docs/reference", "docs/guide"]) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) if (name.endsWith(".md")) files.push(path.join(ROOT, dir, name));
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "AGENTS.md") files.push(full);
    }
  };
  walk(ROOT);
  return files;
}

function referencedPaths(text) {
  const out = new Set();
  for (const [, raw] of text.matchAll(/`([^`\s]+)`/g)) {
    const value = raw.replace(/[),.:;]+$/, "").replace(/:\d+(-\d+)?$/, "");
    if (!ROOTS.some((root) => value.startsWith(root))) continue;
    if (/[<>*{}$~]|X\.Y\.Z/.test(value)) continue; // 자리표시자·글롭·범위
    out.add(value);
  }
  return out;
}

test("guide documents only point at code paths that exist", () => {
  const missing = [];
  for (const file of guides()) {
    for (const ref of referencedPaths(fs.readFileSync(file, "utf8"))) {
      if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${path.relative(ROOT, file)} → ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
});
