"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { activityStaysAtBottom, actRange, chatActivityHTML } = require("../ui/js/view/chat-activity");

test("끝난 턴 활동은 다음 사용자 메시지가 생기면 목록 맨 아래에 두지 않는다", () => {
  const previous = { role: "user", ts: 10 };
  assert.equal(activityStaysAtBottom(false, previous, 20), true);
  assert.equal(activityStaysAtBottom(false, { role: "assistant", ts: 30 }, 20), true);
  assert.equal(activityStaysAtBottom(false, { role: "user", ts: 20 }, 20), true);
  assert.equal(activityStaysAtBottom(false, { role: "user", ts: "1970-01-01T00:00:00.030Z" }, 20), false);
  assert.equal(activityStaysAtBottom(false, { role: "user", ts: 30 }, 20), false);
  assert.equal(activityStaysAtBottom(true, { role: "user", ts: 30 }, 20), true);
  assert.equal(activityStaysAtBottom(false, { role: "user", ts: 30 }, 0), true);
  assert.equal(activityStaysAtBottom(false, null, 20), true);
});

test("turn_end 뒤의 새 작업만 진행 중이고, 작업이 없으면 직전 턴을 가리킨다", () => {
  const list = [
    { kind: "think", text: "첫 생각" },
    { kind: "turn_end", ts: 1 },
    { kind: "tool", name: "Read" },
    { kind: "turn_end", ts: 2 },
    { kind: "notify", text: "알림" },
  ];
  assert.deepEqual(actRange(list).running, false);
  assert.deepEqual(actRange(list).items.map((it) => it.kind), ["tool"]);
  list.push({ kind: "think", text: "다음" });
  const running = actRange(list);
  assert.equal(running.running, true);
  assert.deepEqual(running.items.map((it) => it.kind), ["notify", "think"]);
});

test("다음 사용자 메시지 아래에는 이전 턴 요약 대신 보관함만 남긴다", () => {
  global.esc = (s) => String(s ?? "");
  global.cut = (s) => String(s ?? "");
  global.mdHTML = (s) => String(s ?? "");
  global.HIDE_DONE_SUBS = false;
  global.liveItems = () => [
    { kind: "tool", name: "Read", seq: 1, done: true, args: "", out: "" },
    { kind: "turn_end", ts: 20, seq: 2 },
  ];
  global.chatTurnHistory = () => [{ ts: 20, items: [{ kind: "tool", name: "Read", seq: 1 }] }];
  global.nodeById = () => ({ messages: [{ role: "user", ts: 30, text: "다음 지시" }] });
  const html = chatActivityHTML("node", { log: [], actTurn: null, actOpen: false });
  assert.match(html, /이전 작업 1턴/);
  assert.equal(html.includes("lvsum"), false);
  assert.equal(html.includes('class="lvact"'), false);
});
