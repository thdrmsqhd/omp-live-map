"use strict";

// 처음 쓰는 사람은 폴더 → 할 일 → 한 줄 목표만 고르고 실행한다. 하네스·루프는 기본 구성에서 템플릿에 맞게 앱이 고른다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { listPresets } = require("../server/engineering/workflow-presets");

const load = () => import(pathToFileURL(path.join(__dirname, "../ui/js/first-run.js")).href);
const defaults = { author: "h-author", reviewer: "h-review", triage: "h-triage", loop: "l-feature", loops: { bugfix: "l-bugfix" } };
const definitions = [
  { id: "h-author", kind: "harness", version: 2 }, { id: "h-review", kind: "harness", version: 1 },
  { id: "h-triage", kind: "harness", version: 3 }, { id: "l-feature", kind: "loop", version: 1 }, { id: "l-bugfix", kind: "loop", version: 4 },
];

test("a template gets only the roles it needs, with the loop meant for it and the saved versions", async () => {
  const { quickRefs } = await load();
  const preset = (id) => listPresets().find((item) => item.id === id);
  assert.deepEqual(quickRefs(preset("bugfix"), defaults, definitions), {
    author: { id: "h-author", version: 2 }, reviewer: { id: "h-review", version: 1 }, loop: { id: "l-bugfix", version: 4 },
  });
  assert.deepEqual(quickRefs(preset("review"), defaults, definitions), { reviewer: { id: "h-review", version: 1 } });
  assert.deepEqual(quickRefs(preset("incident"), defaults, definitions), {
    author: { id: "h-author", version: 2 }, triage: { id: "h-triage", version: 3 },
  });
  assert.deepEqual(quickRefs(preset("feature"), defaults, definitions).loop, { id: "l-feature", version: 1 }, "a template without its own loop uses the default loop");
});

test("an empty acceptance falls back to a plain default", async () => {
  const { QUICK_ACCEPTANCE } = await load();
  assert.ok(QUICK_ACCEPTANCE.length > 10);
});

test("every template explains in one line what it does", () => {
  for (const { id, summary } of listPresets()) assert.ok(typeof summary === "string" && summary.length > 5 && summary.length <= 40, id);
});

test("the target folder is the most recent session's folder unless a session asked for its own", async () => {
  const { quickFolders } = await load();
  const sessions = ["C:\\work\\site", "c:/work/site/", "C:\\work\\api"];
  const projects = [{ root: "C:\\work\\old", archived: 0 }, { root: "C:\\work\\api", archived: 0 }, { root: "C:\\work\\gone", archived: 1 }];
  assert.deepEqual(quickFolders({ sessions, projects }), { folders: ["C:\\work\\site", "C:\\work\\api", "C:\\work\\old"], chosen: "C:\\work\\site" });
  assert.equal(quickFolders({ sessions, projects, preferred: "C:\\work\\api" }).chosen, "C:\\work\\api", "a session card's folder wins");
  assert.deepEqual(quickFolders({ sessions, projects, preferred: "D:\\new" }).folders[0], "D:\\new");
  assert.equal(quickFolders({ sessions: [], projects, remembered: "C:\\work\\old" }).chosen, "C:\\work\\old", "with no sessions the last used folder is kept");
  assert.deepEqual(quickFolders({ sessions: [], projects: [] }), { folders: [], chosen: "" });
});
