"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { openDatabase } = require("../server/engineering/database");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");
const { workflowEngine } = require("../server/engineering/workflow-engine");

test("a workflow executes the selected branch, persists approval and never replays an uncertain node", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-flow-run-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const observed = [];
    const runner = { async verify(checks) {
      const [{ command }] = checks;
      observed.push(command);
      return [{ command, passed: command !== "first-check" }];
    } };
    const engine = workflowEngine(runs, workflows, definitions, runner, { async create() { return directory; } });
    const node = (id, type, config = {}) => ({ id, label: id, type, ...config });
    const command = (id) => node(id, "command", { check: { command: id, args: [] } });
    const edge = (from, to, port) => ({ from, to, port });
    const saved = workflows.save({ project: "one", payload: { name: "approval", nodes: [
      node("s", "start"), command("first-check"), node("c", "condition", { source: "first-check", field: "passed", equals: true }),
      node("a", "approval", { prompt: "Review fallback" }), command("after-approval"), node("e", "end"),
    ], edges: [edge("s","first-check"), edge("first-check","c"), edge("c","e","true"), edge("c","a","false"),
      edge("a","after-approval","approved"), edge("after-approval","e")] } });
    const input = { project: "one", workflow: saved.id, version: 1, title: "try", timeoutMs: 3000, budgetCents: 100 };
    const run = engine.start(input, "retry-key");
    assert.equal(engine.start(input, "retry-key").id, run.id);
    const waitFor = async (id, status) => {
      for (let i = 0; i < 100 && runs.get(id).status !== status; i++) await delay(10);
      assert.equal(runs.get(id).status, status);
    };
    await waitFor(run.id, "waiting_approval");
    assert.deepEqual(observed, ["first-check"]);
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "a").outcome.prompt, "Review fallback");
    assert.throws(() => engine.decide(run.id, "a", "rejected", ""), /approval reason/);
    engine.decide(run.id, "a", "approved", "reviewed");
    await waitFor(run.id, "succeeded");
    assert.deepEqual(observed, ["first-check", "after-approval"]);
    assert.throws(() => engine.decide(run.id, "a", "approved", "duplicate"), /not pending/);

    const interrupted = runs.create(input, "uncertain").run;
    runs.change(interrupted.id, ["queued"], "running");
    runs.begin(interrupted.id, "first-check");
    runs.recover();
    assert.equal(runs.get(interrupted.id).status, "interrupted");
    assert.equal(runs.nodes(interrupted.id)[0].status, "interrupted");
    assert.throws(() => engine.action(interrupted.id, "resume"), /uncertain/);
    assert.deepEqual(observed, ["first-check", "after-approval"]);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
