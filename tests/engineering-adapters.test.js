"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { adaptersFor } = require("../server/engineering/adapters");
const { commandRunner } = require("../server/engineering/command-runner");

test("isolated-adapter injection exercises OMP and Claude fixture protocols", { timeout: 12000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-adapter-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 4 }));
  const backend = {
    enforced: true,
    supports: () => true,
    launch(program, args, options) {
      const files = {
        omp: path.join(__dirname, "fake-omp", "fake-omp.js"),
        claude: path.join(__dirname, "fake-claude", "fake-claude.js"),
      };
      const start = files[program] ? [files[program], ...args] : args;
      return spawn(process.execPath, start, { ...options, env: { ...process.env,
        FAKE_OMP_HOME: directory, FAKE_OMP_LOG: path.join(directory, "rpc.jsonl"), FAKE_OMP_SCENARIO: "",
        FAKE_CLAUDE_HOME: directory, FAKE_CLAUDE_DELAY: "1",
      } });
    },
    terminate(child) { child.kill(); },
  };
  const model = { provider: "fake", model: "fake-1" };
  const shared = { model, cwd: directory, instruction: "fixture", feedback: [], budgetCents: 4 };
  const agents = adaptersFor(backend);
  for (const [adapter, agent] of agents) {
    const context = { ...shared, harness: { adapter, role: "developer" }, signal: AbortSignal.timeout(5000) };
    const result = await agent.run(context);
    assert.equal(result.model, model.model);
    assert.ok(result.sessionId);
    assert.ok(result.costCents >= 0);
  }

  const code = "process.exit(3)";
  const permitted = { command: "node", args: ["-e", code] };
  const slow = { command: "node", args: ["-e", "setTimeout(() => {}, 5000)"] };
  const commands = commandRunner(backend, [permitted, slow]);
  assert.equal((await commands.execute(permitted, directory, AbortSignal.timeout(3000))).code, 3);
  await assert.rejects(commands.execute({ command: "node", args: ["unexpected.js"] }, directory, new AbortController().signal), /not allowed/);
  await assert.rejects(commands.execute(slow, directory, AbortSignal.timeout(80)), { name: "TimeoutError" });
});
