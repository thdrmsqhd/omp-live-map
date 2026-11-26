"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { claudeStreamProgress, ompToolLine, partialString } = require("../server/engineering/stream-progress");

const event = (inner) => ({ type: "stream_event", event: inner });
const delta = (value) => event({ type: "content_block_delta", index: 0, delta: value });

test("Claude stream progress shows text, tool targets and the file body a tool is writing as it arrives", () => {
  const patches = [];
  const feed = claudeStreamProgress((patch) => patches.push(patch));
  feed(event({ type: "content_block_start", content_block: { type: "thinking" } }));
  feed(delta({ type: "thinking_delta", thinking: "hidden" }));
  feed(delta({ type: "text_delta", text: "리뷰를 시작합니다." }));
  feed(event({ type: "content_block_start", content_block: { type: "tool_use", name: "Write" } }));
  const input = JSON.stringify({ file_path: "/workspace/review.md", content: "# 리뷰\n- \"reconnect\" 는 닫힌 소켓을 재사용" });
  for (let index = 0; index < input.length; index += 7) feed(delta({ type: "input_json_delta", partial_json: input.slice(index, index + 7) }));
  feed(event({ type: "content_block_stop" }));
  feed({ type: "assistant", message: {} });
  const text = patches.map(({ text }) => text ?? "").join("");
  assert.equal(text, "리뷰를 시작합니다.\n▸ Write review.md\n# 리뷰\n- \"reconnect\" 는 닫힌 소켓을 재사용\n");
  assert.ok(!text.includes("hidden"));
  assert.deepEqual([...new Set(patches.map(({ phase }) => phase).filter(Boolean))], ["thinking", "responding", "tool", "writing"]);
  assert.equal(patches.find(({ tool }) => tool).tool, "Write");
});

test("partial JSON strings decode only complete escapes and OMP tool lines name their target", () => {
  assert.deepEqual(partialString('{"content":"a\\nb\\', "content"), { text: "a\nb", done: false });
  assert.deepEqual(partialString('{"file_path":"/workspace/src/a.js","x"', "file_path"), { text: "/workspace/src/a.js", done: true });
  assert.equal(partialString('{"other":1}', "content"), null);
  assert.equal(ompToolLine({ toolName: "read", args: { path: "/workspace/src/a.js" } }), "\n▸ read src/a.js\n");
  assert.equal(ompToolLine({ toolName: "edit" }), "\n▸ edit\n");
});
