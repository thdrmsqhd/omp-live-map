"use strict";

// 설계 캔버스의 종류별 열 제목(studio.css)은 노드를 놓는 열 좌표(studio-shared.js)와 같은 자리에 있어야 한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

test("each kind's column title sits over the column its nodes are placed in", async () => {
  const { COLUMN } = await import(pathToFileURL(path.join(__dirname, "../ui/js/studio-shared.js")).href);
  const css = fs.readFileSync(path.join(__dirname, "../ui/css/studio.css"), "utf8");
  const left = (type) => Number(css.match(new RegExp(`\\.studio-lane\\[data-type="${type}"\\] \\{ left: (\\d+)`))?.[1]);
  assert.deepEqual(["model", "harness", "loop"].map(left), [COLUMN.model, COLUMN.harness, COLUMN.loop]);
});
