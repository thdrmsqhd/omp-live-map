"use strict";

// 맵 에이전트 카드의 문장(ui/js/model/agent-lines.js): 서버 활동 요약(server/activity.js)을 실제로 만든 뒤
// '목표 / 지금 / 최근 한 일 3개 / 결과' 한국어 줄로 바꾼다. omp 툴 이름(소문자)과 Claude Code 툴 이름(대문자) 둘 다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const activity = require("../server/activity");

const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../ui/js/model/agent-lines.js"), "utf8"), context);
const run = (code) => vm.runInContext(code, context);
const lines = (node, opts) => plain(run("umapAgentLines")(node, opts));
const line = (item) => run("umapActionLine")(item);

let ts = 0;
function act(calls, status = "live", extra = {}) {
  const a = activity.newActivity();
  activity.onUserText(a, extra.goal || "calc.js 반올림 버그를 고쳐라", ++ts);
  for (const [id, name, args, result] of calls) {
    activity.onCall(a, { id, name, args, ts: ++ts });
    if (result) activity.onResult(a, { id, ...result, ts: ++ts });
  }
  if (extra.said) activity.onAssistantText(a, extra.said, ++ts);
  return activity.summary(a, status, extra);
}

test("omp tools become short Korean sentences: edit (+/−), failing then passing test, read, search, subagents", () => {
  const a = act([
    ["r1", "read", { path: "C:/w/shop/src/calc.js" }, { text: "..." }],
    ["e1", "edit", { path: "C:/w/shop/src/calc.js", oldText: "a\nb", newText: "a\nB\nC\nD\nE" }, { text: "ok" }],
    ["b1", "bash", { command: "cd C:/w/shop && node --test" }, { text: "exit code: 1", error: true }],
    ["b2", "bash", { command: "node --test" }, { text: "pass 12" }],
    ["g1", "grep", { pattern: "round(" }, { text: "" }],
    ["t1", "task", { tasks: [{ name: "Fixer", task: "x" }, { name: "Tester", task: "y" }] }],
  ]);
  const L = lines({ kind: "main", sessionTitle: "calc 버그 수정", status: "live", act: a });
  assert.equal(L.title, "calc 버그 수정");
  assert.equal(L.state, "running");
  assert.equal(L.goal, "calc.js 반올림 버그를 고쳐라");
  assert.equal(L.now, "서브에이전트 2개 대기", "the pending task call is what it is doing now");
  assert.deepEqual(L.recent.map(({ text }) => text), ["node --test 실패", "node --test 통과", "‘round(’ 찾아봄"], "the last 3 finished actions, oldest first");
  assert.equal(L.result, "");
  assert.equal(L.counters, "읽음 1 · 수정 1파일 (+4 −1) · 명령 2 (✓1 ✗1)", "counters stay as small secondary text");
  assert.equal(line({ kind: "edit", file: "C:/w/shop/src/calc.js", add: 4, del: 1 }), "calc.js 고침 (+4 −1)");
  assert.equal(line({ kind: "edit", file: "a/NOTES.md", add: 3, del: 0, write: true }), "NOTES.md 새로 씀 (+3)");
  assert.equal(line({ kind: "edit", file: "a/x.js", add: 5, del: 2, more: 2 }), "x.js 외 2개 고침 (+5 −2)");
  assert.equal(line({ kind: "read", file: "C:\\w\\util.js" }), "util.js 읽음");
  assert.equal(line({ kind: "spawn", n: 1, names: ["Cause"] }), "Cause 서브에이전트를 띄움");
  assert.equal(line({ kind: "spawn", n: 1, desc: "원인 조사" }), "‘원인 조사’ 서브에이전트를 띄움");
  assert.equal(line({ kind: "spawn", n: 0 }), "서브에이전트에 후속 지시");
  assert.equal(line({ kind: "result", who: "Tester", status: "failed" }), "Tester 실패를 보고받음");
  assert.equal(line({ kind: "result", who: "Fixer", status: "completed" }), "Fixer 결과를 받음");
  assert.equal(line({ kind: "command", cmd: "git status", ok: true }), "git status 실행함");
  assert.equal(line({ kind: "tool", tool: "todo_write" }), "할 일 목록 정리");
  assert.equal(line({ kind: "say", text: "생각" }), "", "talk is not an action line");
  assert.equal(line({ kind: "command", cmd: 'powershell -NoProfile -Command "Get-Process KakaoTalk* | Select-Object Id"', ok: true }), "Get-Process KakaoTalk* 실행함", "powershell wrappers show the inner command");
  assert.equal(line({ kind: "command", cmd: 'powershell -Command "\\$s = Join-Path $env:TEMP x; Get-Item $s"', ok: true }), "Join-Path $env:TEMP x 실행함", "a leading variable assignment is dropped");
  assert.equal(line({ kind: "command", cmd: "python ./x.py; result=$?; echo $result", ok: false }), "python ./x.py 실패", "chained commands show the first one");
  assert.equal(line({ kind: "tool", tool: "mcp__openclaw__exec" }), "openclaw exec 사용");
  assert.equal(run("umapNowLine")({ kind: "command", cmd: "npm test" }), "테스트 실행 중 · npm test");
  assert.equal(run("umapNowLine")({ kind: "edit", file: "src/calc.js" }), "calc.js 수정 중");
});

test("Claude Code tool names (Read/Edit/Bash/Grep/Agent/TodoWrite) give the same sentences", () => {
  const a = act([
    ["c1", "Read", { file_path: "C:/w/shop/login.js" }, { text: "..." }],
    ["c2", "Edit", { file_path: "C:/w/shop/login.js", old_string: "x", new_string: "x\ny" }, { text: "ok" }],
    ["c3", "TodoWrite", { todos: [] }, { text: "ok" }],
    ["c4", "Bash", { command: "npm test" }, { text: "1 failing", error: true }],
    ["c5", "Agent", { description: "원인 조사", prompt: "find the cause" }],
  ], "live");
  const L = lines({ kind: "main", firstUser: "로그인 폼 검증 추가", harness: "claude", status: "live", act: a }, { harness: "Claude Code" });
  assert.equal(L.title, "로그인 폼 검증 추가", "without a session title the first instruction is the title");
  assert.equal(L.now, "서브에이전트 1개 대기");
  assert.deepEqual(L.recent.map(({ text }) => text), ["login.js 고침 (+1 −0)", "할 일 목록 정리", "npm test 실패"]);
  assert.equal(L.recent[0].file, "C:/w/shop/login.js", "an edit line carries its file so a click opens that diff");
  assert.equal(L.recent[2].bad, true);
  const busy = lines({ kind: "main", status: "live", act: act([["d1", "Bash", { command: "npm run build" }]]) }, { harness: "Claude Code" });
  assert.equal(busy.title, "Claude Code 세션", "never just '에이전트': falls back to the harness name");
  assert.equal(busy.now, "npm run build 실행 중");
});

test("subagent, finished, failed, waiting and needs-answer cards", () => {
  const done = act([["e", "edit", { path: "a/calc.js", oldText: "a", newText: "b" }, { text: "ok" }]], "done", { goal: "calc.js round() 를 고쳐라", result: "음수 반올림 수정, 테스트 12개 통과" });
  const sub = lines({ kind: "sub", name: "Fixer", agent: "task", status: "done", act: done });
  assert.deepEqual([sub.title, sub.sub, sub.state, sub.goal, sub.now, sub.result], ["Fixer", true, "done", "calc.js round() 를 고쳐라", "", "음수 반올림 수정, 테스트 12개 통과"]);
  const failed = lines({ kind: "sub", name: "Tester", status: "done", act: act([], "done", { failed: true, result: "경계값 테스트 1개 실패" }) });
  assert.equal(failed.state, "failed");
  assert.equal(failed.result, "실패 · 경계값 테스트 1개 실패");
  const idle = lines({ kind: "main", title: "t", status: "idle", act: act([], "idle") });
  assert.equal(idle.now, "다음 지시를 기다리는 중");
  const ask = lines({ kind: "main", title: "t", status: "live", act: act([], "live") }, { ask: true });
  assert.deepEqual([ask.state, ask.label, ask.now], ["ask", "답 필요", "선택을 기다림 · 답이 필요합니다"]);
  assert.equal(lines({ kind: "sub", status: "live" }, { harness: "omp" }).title, "omp 서브에이전트");
  assert.equal(lines({ kind: "main", status: "live" }, { alias: "내 별칭" }).title, "내 별칭");
  assert.equal(lines({ kind: "main", status: "live" }).goal, "(지시 기록 없음)");
  assert.equal(lines({ kind: "main", title: "t", status: "done", act: { status: "done", resultSummary: "지금 설정인 **1080p** 그대로 `둠`" } }).result, "지금 설정인 1080p 그대로 둠", "markdown marks are stripped");
});
