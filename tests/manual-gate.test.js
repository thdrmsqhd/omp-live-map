"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");
const { workflowEngine } = require("../server/engineering/workflow-engine");

test("a manual gate pauses before later work and never stores a submitted secret", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-manual-gate-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const observed = [];
    const engine = workflowEngine(runs, workflows, definitions, {
      async verify([{ command }]) { observed.push(command); return [{ command, passed: true }]; },
    }, { async create() { return directory; } });
    const node = (id, type, config = {}) => ({ id, label: id, type, ...config });
    const saved = workflows.save({ project: "one", payload: { name: "manual gate", nodes: [
      node("s", "start"), node("before", "command", { check: { command: "before", args: [] } }),
      node("gate", "approval", { gate: "uac", prompt: "UAC를 직접 처리하세요." }),
      node("after", "command", { check: { command: "after", args: [] } }), node("e", "end"),
    ], edges: [
      { from: "s", to: "before" }, { from: "before", to: "gate" },
      { from: "gate", to: "after", port: "approved" }, { from: "after", to: "e" },
    ] } });
    const run = engine.start({ project: "one", workflow: saved.id, version: 1, title: "gate", timeoutMs: 3000, budgetCents: 100 }, "gate-key");
    for (let i = 0; i < 100 && runs.get(run.id).status !== "waiting_approval"; i++) await delay(10);
    assert.equal(runs.get(run.id).status, "waiting_approval");
    assert.deepEqual(observed, ["before"]);
    const waiting = runs.nodes(run.id).find(({ node }) => node === "gate");
    assert.equal(waiting.outcome.gate, "uac");
    assert.match(waiting.outcome.prompt, /UAC 프롬프트/);
    await engine.decide(run.id, "gate", "rejected", "password=should-not-be-stored");
    for (let i = 0; i < 100 && runs.get(run.id).status === "queued"; i++) await delay(10);
    assert.equal(runs.get(run.id).status, "failed");
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "gate").outcome.reason, "사용자가 수동 작업을 진행하지 않음");
    assert.equal(JSON.stringify(runs.nodes(run.id)).includes("should-not-be-stored"), false);
    assert.deepEqual(observed, ["before"]);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
