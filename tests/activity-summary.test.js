"use strict";

// 활동 요약(server/activity.js · activity-tree.js): omp·Claude Code 기록 줄을 실제 수집 경로(ingest·claude ingestLine)로 넣고
// 목표·상태·지금 하는 일·읽기/수정(+/−)/명령(통과/실패)·결과 한 줄·최근 활동·자식(중첩 서브에이전트)을 확인한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { SESSIONS } = require("../server/config");
const { newFileState, parentOf, ingest } = require("../server/ingest");
const claude = require("../server/harness/claude");
const activity = require("../server/activity");
const { treeActivity } = require("../server/activity-tree");

const T0 = Date.parse("2026-11-28T01:00:00Z");
let tick = 0;
const at = () => new Date(T0 + 1000 * ++tick).toISOString();
const omp = {
  user: (text) => ({ type: "message", timestamp: at(), message: { role: "user", content: text } }),
  say: (text, calls = [], stopReason = calls.length ? "toolUse" : "stop") => ({ type: "message", timestamp: at(), message: { role: "assistant", stopReason,
    content: [...(text ? [{ type: "text", text }] : []), ...calls.map(([id, name, args]) => ({ type: "toolCall", id, name, arguments: args }))] } }),
  result: (id, toolName, text, isError = false) => ({ type: "message", timestamp: at(), message: { role: "toolResult", toolCallId: id, toolName, isError, content: [{ type: "text", text }] } }),
};
function feed(file, rows) {
  const st = newFileState(file);
  for (const row of rows) ingest(st, JSON.stringify(row));
  return st;
}

test("omp: main agent spawns two subagents, one spawns a nested one; edits, reads, commands and results roll up per node", () => {
  const dir = path.join(SESSIONS, "--C--w--shop--"), mainFile = path.join(dir, "2026-11-28_sid1.jsonl");
  const main = feed(mainFile, [
    { type: "session", id: "sid1", cwd: "C:/w/shop", timestamp: at() },
    omp.user("작업·검증: calc.js 의 반올림 버그를 고치고 테스트를 통과시켜라"),
    omp.say("두 서브에이전트에 나눕니다.", [["t1", "task", { tasks: [
      { name: "Fixer", agent: "task", task: "calc.js round() 를 고쳐라\n세부: 음수 처리" },
      { name: "Tester", agent: "reviewer", task: "테스트를 추가하고 돌려라" }] }]]),
    omp.result("t1", "task", '<task-result id="Fixer" agent="task" status="completed" duration="40s"><output>\nround() 음수 반올림 수정, 테스트 12개 통과\n</output></task-result>' +
      '<task-result id="Tester" agent="reviewer" status="failed" duration="30s"><output>\n경계값 테스트 1개 실패\n</output></task-result>'),
    omp.say("Fixer 는 끝났고 Tester 가 실패했습니다. 경계값을 다시 봅니다."),
  ]);
  const fixerFile = path.join(dir, "2026-11-28_sid1", "Fixer.jsonl");
  const fixer = feed(fixerFile, [
    omp.user("calc.js round() 를 고쳐라"),
    omp.say("", [["r1", "read", { path: "C:/w/shop/src/calc.js" }], ["r2", "read", { path: "C:/w/shop/src/util.js" }]]),
    omp.result("r1", "read", "..."), omp.result("r2", "read", "..."),
    omp.say("고칩니다.", [["e1", "edit", { path: "C:/w/shop/src/calc.js", oldText: "a\nb\nc", newText: "a\nB\nB2\nc" }]]),
    omp.result("e1", "edit", "ok"),
    omp.say("", [["b1", "bash", { command: "node --test" }]]), omp.result("b1", "bash", "exit code: 1", true),
    omp.say("", [["b2", "bash", { command: "node --test" }]]), omp.result("b2", "bash", "pass 12"),
    omp.say("", [["t2", "task", { tasks: [{ name: "Checker", task: "변경을 검토해라" }] }]]),
    omp.result("t2", "task", '<task-result id="Checker" agent="task" status="completed"><output>\n문제 없음\n</output></task-result>'),
    omp.say("round() 음수 반올림을 고쳤습니다.\n테스트 12개 통과."),
  ]);
  const checkerFile = path.join(dir, "2026-11-28_sid1", "Fixer", "Checker.jsonl");
  const checker = feed(checkerFile, [omp.user("변경을 검토해라"), omp.say("", [["w1", "write", { path: "C:/w/shop/NOTES.md", content: "x\ny\nz" }]])]);
  const testerFile = path.join(dir, "2026-11-28_sid1", "Tester.jsonl");
  const tester = feed(testerFile, [omp.user("테스트를 추가하고 돌려라"), omp.say("실패했습니다.", [], "error")]);
  assert.equal(parentOf(checkerFile, checker.depth), fixerFile, "nested subagent file points at its parent subagent");

  const states = new Map([[mainFile, main], [fixerFile, fixer], [checkerFile, checker], [testerFile, tester]]);
  const nodes = [
    { id: mainFile, parent: null, kind: "main", name: "main", status: "done" },
    { id: fixerFile, parent: mainFile, kind: "sub", name: "Fixer", status: "done" },
    { id: testerFile, parent: mainFile, kind: "sub", name: "Tester", status: "done" },
    { id: checkerFile, parent: fixerFile, kind: "sub", name: "Checker", status: "live" },
  ];
  treeActivity(nodes, (n) => states.get(n.id) || null);
  const [m, f, t, c] = nodes.map((n) => n.act);
  assert.equal(m.goal, "작업·검증: calc.js 의 반올림 버그를 고치고 테스트를 통과시켜라");
  assert.deepEqual(m.children, [fixerFile, testerFile]);
  assert.equal(m.status, "done");
  assert.equal(m.resultSummary, "Fixer 는 끝났고 Tester 가 실패했습니다. 경계값을 다시 봅니다.");
  assert.equal(f.goal, "calc.js round() 를 고쳐라", "the subagent goal is the instruction the parent gave it (first line)");
  assert.equal(f.resultSummary, "round() 음수 반올림 수정, 테스트 12개 통과", "the result is what the parent received");
  assert.deepEqual(f.children, [checkerFile]);
  assert.deepEqual(f.reads.map(({ file }) => path.basename(file)), ["calc.js", "util.js"]);
  assert.deepEqual(f.edits, [{ file: "C:/w/shop/src/calc.js", add: 2, del: 1, n: 1 }]);
  assert.deepEqual(f.commands.map(({ cmd, ok }) => [cmd, ok]), [["node --test", false], ["node --test", true]]);
  assert.deepEqual({ ok: f.counts.ok, fail: f.counts.fail, commands: f.counts.commands, reads: f.counts.reads }, { ok: 1, fail: 1, commands: 2, reads: 2 });
  assert.equal(f.recent.length, 10, "recent activity is capped to the last 10 items");
  assert.ok(f.recent.every((item, i, all) => !i || all[i - 1].ts <= item.ts), "recent items are in time order");
  assert.equal(t.status, "failed", "a subagent the parent saw fail is failed");
  assert.equal(t.resultSummary, "경계값 테스트 1개 실패");
  assert.equal(c.status, "running");
  assert.equal(c.goal, "변경을 검토해라");
  assert.equal(c.currentActivity, "NOTES.md 수정 중", "a running agent shows the tool it is in");
  assert.deepEqual(c.edits, [{ file: "C:/w/shop/NOTES.md", add: 3, del: 0, n: 1 }], "write counts the written lines");
  assert.equal(fixer.act.diffs.get("C:/w/shop/src/calc.js")[0].new, "a\nB\nB2\nc", "the edit hunk is kept server-side for the drawer");
});

test("Claude Code: Agent tool subagent gets goal from the parent's description, edits/commands from tool_use + tool_result", () => {
  const dir = "C:/tmp/claude-projects/C--w-shop", mainFile = path.join(dir, "s1.jsonl");
  const main = claude.newState(mainFile);
  const line = (o) => claude.ingestLine(main, JSON.stringify({ timestamp: at(), cwd: "C:/w/shop", ...o }));
  line({ type: "user", message: { role: "user", content: "로그인 폼 검증 추가" } });
  line({ type: "assistant", message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "Agent", input: { description: "폼 검증 테스트 작성", prompt: "You are a tester.\nWrite tests", subagent_type: "tester" } }] } });
  line({ type: "assistant", message: { id: "m2", stop_reason: "tool_use", content: [
    { type: "tool_use", id: "tu2", name: "Edit", input: { file_path: "C:/w/shop/login.js", old_string: "x", new_string: "x\ny" } },
    { type: "tool_use", id: "tu3", name: "Bash", input: { command: "npm test" } }] } });
  line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "테스트 4개 작성" }] },
    { type: "tool_result", tool_use_id: "tu3", is_error: true, content: "1 failing" }] } });
  const sub = Object.assign(claude.newState(path.join(dir, "s1", "subagents", "agent-a1.jsonl")), { kind: "sub", sidechain: true, toolUseId: "tu1", harness: "claude" });
  claude.ingestLine(sub, JSON.stringify({ type: "user", isSidechain: true, timestamp: at(), message: { role: "user", content: "You are a tester.\nWrite tests" } }));
  claude.ingestLine(sub, JSON.stringify({ type: "assistant", isSidechain: true, timestamp: at(), message: { id: "s1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "x1", name: "Read", input: { file_path: "C:/w/shop/login.js" } }] } }));
  const nodes = [{ id: mainFile, parent: null, kind: "main", name: "main", status: "live" }, { id: sub.file, parent: mainFile, kind: "sub", name: "tester", status: "live", title: "폼 검증 테스트 작성" }];
  treeActivity(nodes, (n) => (n.id === mainFile ? main : sub));
  const [m, s] = nodes.map((n) => n.act);
  assert.equal(m.goal, "로그인 폼 검증 추가");
  assert.deepEqual(m.edits, [{ file: "C:/w/shop/login.js", add: 1, del: 0, n: 1 }]);
  assert.deepEqual(m.commands.map(({ cmd, ok }) => [cmd, ok]), [["npm test", false]]);
  assert.equal(m.currentActivity, "login.js 수정 중", "the edit has no tool_result yet");
  assert.equal(s.goal, "폼 검증 테스트 작성");
  assert.equal(s.currentActivity, "login.js 읽는 중");
  assert.deepEqual(s.reads, [{ file: "C:/w/shop/login.js", n: 1 }]);
  assert.deepEqual(m.children, [sub.file]);
});

test("edit line deltas: replace pairs, multi-edit arrays and apply_patch text", () => {
  assert.deepEqual(activity.lineDelta("a\nb\nc", "a\nc"), { add: 0, del: 1 });
  assert.deepEqual(activity.editsOf({ path: "f.js", edits: [{ oldText: "a", newText: "a\nb" }, { oldText: "x\ny", newText: "z" }] }).map(({ add, del }) => [add, del]), [[2, 2]]);
  const patch = "*** Begin Patch\n*** Update File: src/a.js\n@@\n-old\n+new\n+more\n*** Add File: src/b.js\n+hello\n*** End Patch";
  assert.deepEqual(activity.editsOf({ input: patch }).map(({ file, add, del }) => [file, add, del]), [["src/a.js", 2, 1], ["src/b.js", 1, 0]]);
  assert.deepEqual(activity.editsOf({ path: "agent://Fixer", content: "후속 지시" }), [], "a follow-up to a subagent is not a file edit");
});

test("omp hashline edit input ([file#hash] blocks) counts the file and +/- lines", () => {
  const { editsOf } = require("../server/activity");
  const input = "[monitor_lamp.py#55B0]\nPUT 7.=10:\n+    print('a')\n+    print('b')\n-    old()\n[README.md#A1]\nPUT 1.=1:\n+line";
  const got = editsOf({ i: "Adding CSV logging", input });
  assert.deepEqual(got.map(({ file, add, del }) => ({ file, add, del })),
    [{ file: "monitor_lamp.py", add: 2, del: 1 }, { file: "README.md", add: 1, del: 0 }]);
  const wrapped = editsOf({ input: "*** Begin Patch\n[C:/x/y.json#9F]\nPUT 2.=2:\n+  \"a\": 1\n*** End Patch" });
  assert.deepEqual(wrapped.map(({ file, add, del }) => ({ file, add, del })), [{ file: "C:/x/y.json", add: 1, del: 0 }]);
});
