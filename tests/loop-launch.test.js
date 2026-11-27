"use strict";

// PR-15: 단독 Loop 실행이 Start → Loop → End Workflow 로 돌고, 맵의 Workflow 실행 목록에 나타나는지 확인한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");
const { workflowEngine } = require("../server/engineering/workflow-engine");
const { workflowObservability } = require("../server/engineering/workflow-observability");
const { loopLaunch } = require("../server/engineering/workflow-launch");

test("a standalone Loop launch becomes a one-step workflow run that the live map can see", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-loop-launch-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", root, "Fixture", "main");
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("two", root + "-2", "Other", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const model = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "fixture", model: "fake" } });
    const harness = definitions.saveDefinition({ project: "one", kind: "harness", payload: { name: "Dev", adapter: "claude", model: model.id, role: "dev" } });
    const loop = definitions.saveDefinition({ project: "one", kind: "loop", payload: {
      name: "Development", harness: harness.id, attempts: 2, timeoutMs: 5000, budgetCents: 50,
      checks: [{ command: "node", args: ["--test"], code: 0 }] } });
    const instructions = [];
    const runner = {
      requireAdapter() { return { async run({ instruction }) { instructions.push(instruction); return { sessionId: "s", costCents: 1, costBasis: "reported" }; } }; },
      async verify(checks) { return checks.map(({ command }) => ({ command, passed: true })); },
    };
    const engine = workflowEngine(runs, workflows, definitions, runner, { async create(_, run) {
      const directory = path.join(root, run.id);
      await fs.mkdir(directory);
      return directory;
    } });
    const input = { project: "one", definition: loop.id, title: "Fix reconnect", instruction: "Reconnect when the link returns", key: "loop-1" };

    assert.throws(() => loopLaunch(definitions, workflows, engine, runner, { ...input, project: "two", key: "x" }), /available to this project/);
    const run = loopLaunch(definitions, workflows, engine, runner, input);
    assert.equal(loopLaunch(definitions, workflows, engine, runner, input).id, run.id, "the idempotency key returns the same run");
    for (let i = 0; i < 200 && ["queued", "running"].includes(runs.get(run.id).status); i++) await delay(5);
    assert.equal(runs.get(run.id).status, "succeeded", JSON.stringify(runs.nodes(run.id)));
    assert.equal(runs.get(run.id).budget, 50, "budget comes from the Loop definition");
    assert.ok(instructions.some((text) => text.includes("Reconnect when the link returns")), "the run instruction reaches the Loop agent");

    const saved = workflows.list("one");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].generated, true);
    assert.equal(saved[0].template, "Loop 실행");
    const nodes = workflows.get("one", saved[0].id).payload.nodes.map(({ type }) => type);
    assert.deepEqual(nodes, ["start", "loop", "end"]);
    const again = loopLaunch(definitions, workflows, engine, runner, { ...input, key: "loop-2", title: "Again" });
    assert.equal(again.workflow, run.workflow, "the generated workflow is reused");
    for (let i = 0; i < 200 && ["queued", "running"].includes(runs.get(again.id).status); i++) await delay(5);

    const live = workflowObservability(db, runs, root).liveMapRuns();
    assert.ok(live.recent.some(({ id }) => id === run.id), "the live map lists the run");
    assert.equal(db.prepare("SELECT count(*) AS n FROM run").get().n, 0, "no standalone run rows are created");
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
