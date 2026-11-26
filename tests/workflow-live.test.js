"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const live = require("../server/engineering/workflow-live");

test("workflow live progress keeps a masked text tail, recent tools and prompt sections until the node ends", () => {
  const run = "run-live-" + Date.now();
  live.start(run, "work", { attempts: 3 });
  const report = live.reporter(run, "work");
  report({ phase: "prompting", attempt: 1, reset: true, sections: [{ name: "role", chars: 10 }, { name: "task", chars: 32 }] });
  report({ phase: "responding", text: "x".repeat(2000) });
  report({ text: " token=abc123secret" });
  for (const tool of ["Read", "Grep", "Edit", "Read", "Write", "Glob", "Bash", "Edit"]) report({ phase: "tool", tool });
  const state = live.snapshot(run).work;
  assert.equal(state.phase, "tool");
  assert.equal(state.attempt, 1);
  assert.equal(state.attempts, 3);
  assert.equal(state.chars, 42);
  assert.ok(state.text.length <= 1600);
  assert.match(state.text, /token=\[redacted\]$/);
  assert.deepEqual(state.tools, ["Grep", "Read", "Write", "Glob", "Bash", "Edit"]);
  assert.equal(state.tool, "Edit");
  report({ attempt: 2, reset: true });
  assert.equal(live.snapshot(run).work.text, "");
  live.end(run, "work");
  assert.deepEqual(live.snapshot(run), {});
});

test("workflow live reporter never throws into the executor", () => {
  const report = live.reporter("run-safe", "node");
  assert.doesNotThrow(() => report({ sections: [{ name: "role", chars: 5 }], text: 5, tool: null }));
  assert.doesNotThrow(() => report(undefined));
  live.end("run-safe", "node");
});
