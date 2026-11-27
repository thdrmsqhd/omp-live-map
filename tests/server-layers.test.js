"use strict";

// 서버 계층 규칙: engineering(규칙·실행)은 application(조립)·edge(HTTP)·routes 를 require 하지 않는다.
// Workflow 실행 상태 전이는 engineering/state.js 의 표 하나에 적는다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { workflowTransitions, workflowTransitionAllowed } = require("../server/engineering/state");

const ENGINEERING = path.resolve(__dirname, "../server/engineering");

test("engineering modules do not depend on application, edge or routes", () => {
  const problems = [];
  for (const name of fs.readdirSync(ENGINEERING)) {
    if (!name.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(ENGINEERING, name), "utf8");
    for (const [, target] of source.matchAll(/require\("([^"]+)"\)/g)) {
      if (/^\.\.\/(application|edge)\//.test(target) || /^\.\.\/routes/.test(target)) problems.push(`${name} → ${target}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every literal workflow run transition in the engine is in the table", () => {
  const sources = ["workflow-engine.js", "workflow-runs.js"].map((name) => fs.readFileSync(path.join(ENGINEERING, name), "utf8")).join("\n");
  const missing = [];
  for (const [, from, to] of sources.matchAll(/(?:change|setStatus)\(id, \[([^\]]+)\], "(\w+)"/g)) {
    for (const state of from.match(/"(\w+)"/g).map((item) => item.slice(1, -1))) {
      if (!workflowTransitionAllowed(state, to)) missing.push(`${state} → ${to}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.equal(workflowTransitionAllowed("succeeded", "running"), false, "finished runs do not restart");
  assert.ok(Object.isFrozen(workflowTransitions));
});
