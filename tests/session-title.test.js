"use strict";

// 세션 제목·첫 지시 한 줄: 하네스 머리말([OpenClaw: …]·[System …]·[Image attached …]·시각 표시)·시스템 태그 블록·글꼴에 없는 글리프를 걷고
// 다음 의미 있는 사용자 줄로 넘어간다(server/session-title.js). 입력은 이 PC 기록에서 본 모양을 줄여 옮긴 것이다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sessionTitleText } = require("../server/session-title");

test("bracketed harness preambles are skipped and the next meaningful user line is the title", () => {
  const openclaw = '[OpenClaw: 47 earlier messages in this chat from 2026-08-17T12:33:37.488Z to 2026-11-19T07:02:11.863Z, using "deepseek/deepseek-v4-pro" (+4 more models). Their contents are not included here. Before answering, call mcp__openclaw__sessions_history({"sessionKey":"agent:main:main","limit":100}) to read them.]\n\n[Thu 2026-11-19 16:13 GMT+9] 핑. 한 단어로 답해';
  assert.equal(sessionTitleText(openclaw), "핑. 한 단어로 답해");
  // 잘린(닫히지 않은) 머리말 줄은 통째로 건너뛴다.
  assert.equal(sessionTitleText("[OpenClaw: 870 earlier messages in this chat from 2026-10-15T13:01:48.862Z to 2026-11-19T0\n벽 타일 크기 고쳐 줘"), "벽 타일 크기 고쳐 줘");
  assert.equal(sessionTitleText("[System: context compacted]\n[Image attached: screenshot.png]\n이 화면에서 버튼이 겹쳐요"), "이 화면에서 버튼이 겹쳐요");
  assert.equal(sessionTitleText("[OpenClaw: 3 earlier messages]"), "", "a message that is only a preamble has no title — the caller waits for the next one");
  // OpenClaw 메타 문단(⟦openclaw:ctx⟧ 표지 ~ 빈 줄): 대화 정보 json · 지난 대화 목록을 건너 실제 메시지로.
  const ctx = ['[OpenClaw: 870 earlier messages in this chat from 2026-10-15T13:01:48.862Z to 2026-11-19T04:05:36.984Z.]', "",
    "Conversation info: ⟦openclaw:ctx⟧", "```json", '{"chat_id":"telegram:1","sender":{"name":"사용자"},"timestamp":"Thu 2026-11-19 16:29:28 GMT+9"}', "```", "",
    "Conversation context (chronological, selected for current message): ⟦openclaw:ctx⟧",
    "#session:94630ebb 2026-11-19 12:45:36 GMT+9 OpenClaw: 맞아. 최초 접속은 30~60초 정도 흰 화면이 보일 수 있어.", "#session:fece53ee 2026-11-19 12:52:21 GMT+9 User: 오픈클로 너도 뭐 이런거 없어?", "",
    "이 릴스 내용 요약해 줘"].join("\n");
  assert.equal(sessionTitleText(ctx), "이 릴스 내용 요약해 줘");
});

test("system tag blocks are dropped, wrapper tags keep their content, slash commands stay readable", () => {
  assert.equal(sessionTitleText("<system-reminder>\nThe user started this session without choosing a project folder, so your\n</system-reminder>\n세움소프트 포털 요구사항 정리"), "세움소프트 포털 요구사항 정리");
  assert.equal(sessionTitleText("<system-reminder>\nThe user started this session without choosing a project folder"), "", "an unclosed reminder is still not a title");
  assert.equal(sessionTitleText('\n\n<pasted_content id="55c9">\n다음 명령을 그대로 실행해 줘:\ngit init'), "다음 명령을 그대로 실행해 줘:");
  assert.equal(sessionTitleText("<command-message>docs-search</command-message>\n<command-name>/docs-search</command-name>\n<command-args></command-args>"), "/docs-search");
});

test("unrenderable glyphs (Nerd Font private-use icons, replacement characters) are stripped; user bracket labels and emoji stay", () => {
  assert.equal(sessionTitleText("\u{F0502} TV: TV 화면 가장자리 잘림 해결"), "TV: TV 화면 가장자리 잘림 해결");
  assert.equal(sessionTitleText("\uE0A0 main · \uFFFD 빌드 고치기"), "main · 빌드 고치기");
  assert.equal(sessionTitleText("□ □"), "", "only glyphs left → no title");
  assert.equal(sessionTitleText("[역할]\n당신은 선임 개발자입니다"), "[역할]", "a Korean label the user typed is content, not a preamble");
  assert.equal(sessionTitleText("[개인 적용 과제 카드] v1 — 작성일: 2026-10-26"), "[개인 적용 과제 카드] v1 — 작성일: 2026-10-26");
  assert.equal(sessionTitleText("📺 화면 테스트"), "📺 화면 테스트");
  assert.equal(sessionTitleText("  여러   칸\t공백  "), "여러 칸 공백");
  assert.equal(sessionTitleText("가".repeat(200)).length, 120);
  assert.equal(sessionTitleText(null), "");
});
