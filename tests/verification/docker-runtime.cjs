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

for (const adapter of ["claude", "omp"]) {
  test(`real ${adapter} writes files and Loop retries until isolated verification succeeds`,
    { timeout: 120000 }, () => repairFixture(adapter));
}

async function repairFixture(adapter) {
  const { execFileSync } = require("node:child_process");
  const { setTimeout: delay } = require("node:timers/promises");
  const { openDatabase } = require("../../server/engineering/database");
  const { catalog } = require("../../server/engineering/catalog");
  const { runStore } = require("../../server/engineering/run-store");
  const { loopEngine } = require("../../server/engineering/loop");
  const { worktrees } = require("../../server/engineering/worktree");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-docker-loop-"));
  let db;
  try {
    const projectRoot = path.join(temp, "source");
    const workspaceRoot = path.join(temp, "worktrees");
    await fs.mkdir(projectRoot);
    await fs.mkdir(workspaceRoot);
    await fs.writeFile(path.join(projectRoot, "verify.test.cjs"), [
      'const test = require("node:test");',
      'const assert = require("node:assert/strict");',
      'const fs = require("node:fs");',
      'test("third attempt result", () => assert.equal(fs.readFileSync("attempt-3.txt", "utf8"), "fixed"));',
    ].join("\n"));
    for (const args of [["init", "-b", "main"], ["add", "verify.test.cjs"],
      ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-m", "fixture"]]) {
      execFileSync("git", args, { cwd: projectRoot });
    }
    let attempts = 0;
    const requests = [];
    const modelName = "claude-sonnet-4-6";
    const runner = dockerRunner({ image: process.env.OMP_RUNTIME_TEST_IMAGE, context: "default",
      binary: "/usr/bin/docker", workspaceRoot, key: "host-fixture-key",
      upstream: (url, options) => {
        const body = JSON.parse(options.body);
        if (url.endsWith("count_tokens")) return Response.json({ input_tokens: 500 });
        requests.push({ tools: body.tools?.map(({ name, input_schema }) => ({ name, properties: Object.keys(input_schema?.properties ?? {}) })),
          last: body.messages.at(-1)?.content });
        const last = body.messages.at(-1);
        if (Array.isArray(last.content) && last.content.some((block) => block.type === "tool_result")) {
          return providerFixture(url, options, []);
        }
        const tool = body.tools.find(({ name }) => name.toLowerCase() === "write");
        assert.ok(tool, adapter + " Write tool was not exposed");
        const pathField = Object.hasOwn(tool.input_schema.properties, "file_path") ? "file_path" : "path";
        const input = { [pathField]: "/workspace/attempt-" + (++attempts) + ".txt", content: "fixed" };
        return toolResponse(body, tool.name, input, attempts);
      },
    });
    db = openDatabase(path.join(temp, "engineering.sqlite"));
    const definitions = catalog(db);
    const project = await definitions.saveProject({ name: "fixture", root: projectRoot, branch: "main" });
    const model = definitions.saveDefinition({ project: project.id, kind: "model",
      payload: { name: "Claude", provider: "anthropic", model: modelName } });
    const harness = definitions.saveDefinition({ project: project.id, kind: "harness",
      payload: { name: adapter + " editor", adapter, role: "developer", model: model.id } });
    const loop = definitions.saveDefinition({ project: project.id, kind: "loop",
      payload: { name: "verify", harness: harness.id, attempts: 3, timeoutMs: 90000, budgetCents: 1600,
        checks: [{ command: "node", args: ["--test"], code: 0 }] } });
    const store = runStore(db, definitions);
    const engine = loopEngine(store, definitions, runner, worktrees(workspaceRoot));
    const { id } = engine.start({ project: project.id, definition: loop.id, title: "fixture",
      instruction: "Use Write to save a plain text fix in the workspace." }, randomUUID());
    const deadline = Date.now() + 95000;
    while (store.get(id).status === "running" && Date.now() < deadline) await delay(200);
    const result = store.get(id);
    const history = store.attempts(id);
    const files = result.workspace ? await fs.readdir(result.workspace) : [];
    assert.equal(result.status, "succeeded", JSON.stringify({
      attempts, files, requests: requests.map(({ tools, last }) => ({
        tools, last: Array.isArray(last) ? last.filter((item) => item.type === "tool_result") : undefined,
      })), history: history.map(({ status, outcome }) => ({ status, error: outcome?.error })),
    }));
    assert.deepEqual(history.map(({ status }) => status), ["rejected", "rejected", "passed"]);
    assert.equal(await fs.readFile(path.join(result.workspace, "attempt-3.txt"), "utf8"), "fixed");
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" }), "");
  } finally {
    db?.close();
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 3 });
  }
}

function toolResponse(body, name, input, attempt) {
  const message = { id: "msg_tool_" + attempt, type: "message", role: "assistant", model: body.model,
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 0 } };
  const block = { type: "tool_use", id: "toolu_fixture_" + attempt, name, input: {} };
  const events = [
    { type: "message_start", message },
    { type: "content_block_start", index: 0, content_block: block },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 25 } },
    { type: "message_stop" },
  ];
  if (!body.stream) return Response.json({ ...message, content: [{ ...block, input }], stop_reason: "tool_use",
    usage: { input_tokens: 500, output_tokens: 25 } });
  return new Response(events.map((item) => `event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } });
}
