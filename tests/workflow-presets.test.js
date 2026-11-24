"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { openDatabase } = require("../server/engineering/database");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");
const { workflowEngine } = require("../server/engineering/workflow-engine");
const { buildPreset, listPresets } = require("../server/engineering/workflow-presets");

test("all built-in workflows complete with mock tools and enforce design and review approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-presets-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", root, "Fixture", "main");
    const catalogues = catalog(db), workflows = workflowCatalog(db, catalogues);
    const runs = workflowRuns(db, catalogues, workflows);
    const model = catalogues.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "fixture", model: "fake" } });
    const harness = (name) => catalogues.saveDefinition({ project: "one", kind: "harness",
      payload: { name, adapter: "claude", model: model.id, role: name } }).id;
    const author = harness("Author"), reviewer = harness("Reviewer");
    const loop = catalogues.saveDefinition({ project: "one", kind: "loop", payload: {
      name: "Development", harness: author, attempts: 3, timeoutMs: 3000, budgetCents: 100,
      checks: [{ command: "node", args: ["--test"], code: 0 }],
    } }).id;
    const calls = new Map();
    const engine = workflowEngine(runs, workflows, catalogues, {
      requireAdapter() { return { async run({ cwd, instruction }) {
        const output = /OUTPUT FILE: ([^\n]+)/.exec(instruction)[1];
        const file = path.join(cwd, output);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "fixture evidence");
        return { sessionId: "fixture-session", costCents: 1, costBasis: "reported" };
      } }; },
      async verify(checks, cwd) {
        const output = await fs.stat(path.join(cwd, ".workflow-output", "implementation.md")).catch(() => null);
        const count = (calls.get(cwd) ?? 0) + 1;
        calls.set(cwd, count);
        return checks.map(({ command }) => ({ command, passed: !output || count >= 3 }));
      },
    }, { async create(_, run) {
      const directory = path.join(root, run.id);
      await fs.mkdir(directory);
      return directory;
    } });
    for (const preset of listPresets()) {
      const flow = workflows.save({ project: "one", payload: buildPreset(preset.id, { author, reviewer, loop }) });
      const run = engine.start({ project: "one", workflow: flow.id, version: 1, title: preset.id, timeoutMs: 6000, budgetCents: 200 }, preset.id);
      const approved = [];
      for (let i = 0; i < 200; i++) {
        const state = runs.get(run.id).status;
        if (state === "waiting_approval") {
          const gate = runs.nodes(run.id).find(({ status }) => status === "waiting_approval");
          approved.push(gate.node);
          await engine.decide(run.id, gate.node, "approved", "fixture");
        } else if (!["queued","running"].includes(state)) break;
        await delay(5);
      }
      assert.equal(runs.get(run.id).status, "succeeded", preset.id + ": " + JSON.stringify(runs.nodes(run.id)));
      if (preset.id === "feature") {
        assert.deepEqual(approved, ["design-approval", "final-approval"]);
        const attempts = runs.nodes(run.id).find(({ node }) => node === "implementation").outcome.attempts;
        assert.deepEqual(attempts.map(({ checks }) => checks[0].passed), [false, false, true]);
      }
    }
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
