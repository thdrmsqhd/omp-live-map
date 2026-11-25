"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { capMessages } = require("../server/msg-cap");
const { newState } = require("../server/harness/claude");
const { onAssistant } = require("../server/harness/claude-msg");

test("Claude message growth invalidates the cached snapshot byte size", () => {
  const state = newState("/project/fixture.jsonl");
  const append = (text, ts) => onAssistant(state, { message: { id: "turn", content: [{ type: "text", text }] } }, ts);
  const view = () => [{ nodes: [{ messages: state.messages }] }];
  append("first part", 1);
  const first = view();
  capMessages(first);
  assert.equal(first[0].nodes[0].messages.length, 1);
  for (let i = 0; i < 4; i++) append("가".repeat(60_000), i + 2);
  const next = view();
  capMessages(next);
  assert.deepEqual(next[0].nodes[0].messages, []);
  assert.ok(state.messages[0].text.endsWith("가"));
});
