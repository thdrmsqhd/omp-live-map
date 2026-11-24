"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { dockerRunner } = require("../../server/engineering/docker-runner");

function providerFixture(url, options, calls) {
  const body = JSON.parse(options.body);
  if (url.endsWith("count_tokens")) return Response.json({ input_tokens: 100 });
  calls.push(body);
  const message = {
    id: "msg_fixture", type: "message", role: "assistant", model: body.model, content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 },
  };
  const events = [
    { type: "message_start", message },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Verified fixture response." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } },
    { type: "message_stop" },
  ];
  if (!body.stream) return Response.json({ ...message, content: [{ type: "text", text: "Verified fixture response." }],
    stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 12 } });
  return new Response(events.map((item) => `event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } });
}

test("real CLI binaries talk through an offline container to the model broker", { timeout: 120000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-docker-runtime-"));
  const workspace = path.join(temp, randomUUID());
  try {
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, "verify.test.cjs"), 'require("node:test")("works in isolated Docker", () => {});');
    const calls = [];
    const runner = dockerRunner({ image: process.env.OMP_RUNTIME_TEST_IMAGE, context: "default",
      binary: "/usr/bin/docker", workspaceRoot: temp, key: "host-fixture-key",
      upstream: (url, options) => providerFixture(url, options, calls),
    });
    const model = { model: "claude-sonnet-4-6", provider: "anthropic" };
    const checks = [{ command: "node", args: ["--test"], code: 0 }];
    for (const adapter of (process.env.OMP_RUNTIME_TEST_ADAPTERS || "claude,omp").split(",")) {
      const harness = { adapter, role: "developer", instructions: "Reply in plain text. Do not call tools." };
      const agent = runner.requireAdapter(harness, model, checks);
      const count = calls.length;
      const output = await agent.run({ cwd: workspace, harness, model, instruction: "Say hello.", feedback: [],
        budgetCents: 400, signal: AbortSignal.timeout(45000) });
      assert.ok(calls.length > count, adapter + " did not reach model broker");
      assert.ok(output.sessionId);
      console.log(adapter + " completed real CLI broker call");
    }
    const results = await runner.verify(checks, workspace, AbortSignal.timeout(15000));
    assert.equal(results[0].passed, true, results[0].log);
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 3 });
  }
});
