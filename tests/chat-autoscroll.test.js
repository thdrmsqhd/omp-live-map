"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chatNearBottom, CHAT_STICK_SLACK } = require("../ui/js/view/block-chat");

test("스크롤 여유가 없거나 바닥에서 slack 안이면 따라간다", () => {
  assert.equal(CHAT_STICK_SLACK, 48);
  assert.equal(chatNearBottom(0, 200, 180), true);
  assert.equal(chatNearBottom(400, 200, 600), true);
  assert.equal(chatNearBottom(352, 200, 600), true);
  assert.equal(chatNearBottom(351, 200, 600), false);
  assert.equal(chatNearBottom(0, 200, 600), false);
});

test("사용자 정의 slack 경계", () => {
  assert.equal(chatNearBottom(90, 10, 100, 0), true);
  assert.equal(chatNearBottom(89, 10, 100, 0), false);
});
