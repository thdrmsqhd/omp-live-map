"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const activity = require("../ui/js/model/activity");
Object.assign(globalThis, activity);
// viewmodel/live.js 의 actItems 와 같은 조립(테스트가 바꿔 끼우는 전역 liveItems·HIDE_DONE_SUBS 를 쓴다).
globalThis.actItems = (id, st) => activity.actItemsOf(globalThis.liveItems(id), st, globalThis.HIDE_DONE_SUBS);
const { splitRunningItems, chatActivityHTML } = require("../ui/js/view/chat-activity");
const { liveHistoryItems } = require("../ui/js/viewmodel/live");

test("진행 중 생각은 끝난 도구와 분리되어 보이는 쪽에 남는다", () => {
  const { live, done } = splitRunningItems([
    { kind: "think", text: "먼저" },
    { kind: "tool", name: "Read", done: true },
    { kind: "think", text: "다음" },
    { kind: "tool", name: "Edit", done: false },
    { kind: "tool", name: "Bash", done: true, error: true },
    { kind: "text", text: "답" },
  ]);
  assert.deepEqual(live.map((it) => it.kind === "tool" ? it.name : it.kind), ["think", "think", "Edit", "Bash", "text"]);
  assert.deepEqual(done.map((it) => it.name), ["Read"]);
});

test("서브에이전트 진행 중 생각과 스트림 없는 답변은 접힌 목록 밖에 있다", () => {
  global.esc = (s) => String(s ?? "");
  global.cut = (s) => String(s ?? "");
  global.mdHTML = (s) => String(s ?? "");
  global.HIDE_DONE_SUBS = false;
  global.chatTurnHistory = () => [];
  global.nodeById = () => ({ kind: "sub", messages: [] });
  global.liveItems = () => [
    { kind: "think", text: "계획 중", seq: 1 },
    { kind: "tool", name: "Read", done: true, args: "{}", out: "", seq: 2 },
    { kind: "text", text: "부분 답", seq: 3 },
  ];
  const running = chatActivityHTML("sub", { stream: "", log: [] });
  assert.ok(running.indexOf("계획 중") < running.indexOf("<details"));
  assert.match(running, /부분 답/);
  assert.match(running, /완료된 도구 1건/);
  const withStream = chatActivityHTML("sub", { stream: "본문", log: [] });
  assert.equal(withStream.includes("부분 답"), false);
  assert.match(withStream, /계획 중/);
});

test("끝난 서브에이전트 턴은 생각을 펼친 채로 시작한다", () => {
  global.liveItems = () => [
    { kind: "think", text: "서브의 생각", seq: 5 },
    { kind: "turn_end", ts: 10, seq: 6 },
  ];
  const st = { actTurn: null, actOpen: false, stream: "", log: [] };
  const html = chatActivityHTML("sub", st);
  assert.equal(st.actOpen, true);
  assert.match(html, /서브의 생각/);
  assert.match(html, /class="lvact"/);
  global.nodeById = () => ({ kind: "main", messages: [] });
  const main = { actTurn: null, actOpen: true, stream: "", log: [] };
  const mainHtml = chatActivityHTML("main", main);
  assert.equal(main.actOpen, false);
  assert.equal(mainHtml.includes('class="lvact"'), false);
  assert.match(mainHtml, /생각 1/);
});

test("턴 기록에 생각을 남기고 길이를 자른다", () => {
  const saved = liveHistoryItems([
    { kind: "think", text: "생".repeat(9000) },
    { kind: "notify", text: "알림" },
    { kind: "tool", name: "Read", out: "x".repeat(13000) },
  ]);
  assert.deepEqual(saved.map((it) => it.kind), ["think", "tool"]);
  assert.equal(saved[0].text.length, 8000);
  assert.equal(saved[1].out.length, 12000);
});
