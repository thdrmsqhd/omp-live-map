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
  assert.ok(state.text.length <= 4000);
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

test("a finished step keeps its whole transcript (attempt markers, tools, head and tail) on disk", async (t) => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-transcript-"));
  t.after(() => { live.configure({}); return fs.rm(directory, { recursive: true, force: true }); });
  live.configure({ directory });
  const run = "run-transcript-" + Date.now();
  live.start(run, "review", { attempts: 2 });
  const report = live.reporter(run, "review");
  report({ phase: "prompting", attempt: 1, reset: true });
  report({ phase: "tool", tool: "Read", text: "\n▸ Read src/client.js\n" });
  report({ text: "첫 시도 시작 " + "a".repeat(30 * 1024) });
  assert.match(live.transcript(run, "review").entries[0].text, /a$/);
  report({ phase: "prompting", attempt: 2, reset: true });
  report({ text: "b".repeat(250 * 1024) + " 마지막 줄 token=abc123secret" });
  const running = live.transcript(run, "review");
  assert.equal(running.running, true);
  assert.equal(running.entries.length, 1);
  live.end(run, "review");
  // 같은 단계를 다시 실행(재시도)하면 기록이 하나 더 쌓이고 최근 것이 앞에 온다.
  await new Promise((resolve) => setTimeout(resolve, 5));
  live.start(run, "review");
  live.reporter(run, "review")({ text: "재시도 출력" });
  live.end(run, "review");
  const done = live.transcript(run, "review");
  assert.equal(done.running, false);
  assert.equal(done.entries.length, 2);
  assert.match(done.entries[0].text, /재시도 출력/);
  const first = done.entries[1];
  assert.equal(first.attempts, 2);
  assert.deepEqual(first.tools.map(({ name }) => name), ["Read"]);
  assert.ok(first.dropped > 0);
  assert.match(first.text, /^\n▸ Read src\/client\.js\n첫 시도 시작/);
  assert.match(first.text, /가운데 [\d,]+자 생략/);
  assert.match(first.text, /마지막 줄 token=\[redacted\]$/);
  assert.ok(first.text.length < 210 * 1024);
  // 잘못된 id 나 다른 단계는 기록을 돌려주지 않는다.
  assert.deepEqual(live.transcript(run, "other").entries, []);
  assert.deepEqual(live.transcript("", "review").entries, []);
});

test("attempt changes are marked in the transcript", () => {
  const run = "run-attempts-" + Date.now();
  live.start(run, "loop", { attempts: 3 });
  const report = live.reporter(run, "loop");
  report({ attempt: 1, reset: true, text: "one" });
  report({ attempt: 2, reset: true, text: "two" });
  assert.match(live.transcript(run, "loop").entries[0].text, /^one\n\n── 시도 2\/3 ──\ntwo$/);
  live.end(run, "loop");
});
