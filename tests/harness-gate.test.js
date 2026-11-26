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

test("a browser harness waits for a manual gate and never runs before it", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-harness-gate-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const model = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "test", model: "fake" } });
    const harness = definitions.saveDefinition({ project: "one", kind: "harness", payload: {
      name: "Browser", role: "브라우저·데스크톱 조작 하네스", adapter: "claude", model: model.id,
    } });
    const saved = workflows.save({ project: "one", payload: { name: "browser gate", nodes: [
      { id: "s", type: "start", label: "Start" },
      { id: "browse", type: "agent", label: "Browse", definition: harness.id, instruction: "Open the page" },
      { id: "e", type: "end", label: "End" },
    ], edges: [{ from: "s", to: "browse" }, { from: "browse", to: "e" }] } });
    const calls = [];
    const engine = workflowEngine(runs, workflows, definitions, {
      requireAdapter() { return { async run() { calls.push("run"); return { costCents: 1, sessionId: "fixture" }; } }; },
    }, { async create() { return directory; } });
    const run = engine.start({ project: "one", workflow: saved.id, version: 1, title: "gate", timeoutMs: 3000, budgetCents: 20 }, "browser-gate");
    for (let i = 0; i < 100 && runs.get(run.id).status !== "waiting_approval"; i++) await delay(10);
    assert.equal(runs.get(run.id).status, "waiting_approval");
    assert.deepEqual(calls, []);
    const waiting = runs.nodes(run.id).find(({ node }) => node === "browse");
    assert.equal(waiting.outcome.gate, "browser");
    assert.equal(waiting.outcome.hold, true);
    await engine.decide(run.id, "browse", "rejected", "password=do-not-store");
    for (let i = 0; i < 100 && ["queued", "running"].includes(runs.get(run.id).status); i++) await delay(10);
    assert.equal(runs.get(run.id).status, "failed");
    assert.deepEqual(calls, []);
    assert.equal(JSON.stringify(runs.nodes(run.id)).includes("do-not-store"), false);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an approved browser gate then runs the harness once", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-harness-gate-ok-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const model = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "test", model: "fake" } });
    const harness = definitions.saveDefinition({ project: "one", kind: "harness", payload: {
      name: "Browser", role: "브라우저·데스크톱 조작 하네스", adapter: "claude", model: model.id,
    } });
    const saved = workflows.save({ project: "one", payload: { name: "browser continue", nodes: [
      { id: "s", type: "start", label: "Start" },
      { id: "browse", type: "agent", label: "Browse", definition: harness.id, instruction: "Open the page" },
      { id: "e", type: "end", label: "End" },
    ], edges: [{ from: "s", to: "browse" }, { from: "browse", to: "e" }] } });
    let calls = 0;
    const engine = workflowEngine(runs, workflows, definitions, {
      requireAdapter() { return { async run() { calls += 1; return { costCents: 1, sessionId: "fixture" }; } }; },
    }, { async create() { return directory; } });
    const run = engine.start({ project: "one", workflow: saved.id, version: 1, title: "continue", timeoutMs: 3000, budgetCents: 20 }, "browser-ok");
    for (let i = 0; i < 100 && runs.get(run.id).status !== "waiting_approval"; i++) await delay(10);
    await engine.decide(run.id, "browse", "approved", "");
    for (let i = 0; i < 100 && runs.get(run.id).status !== "succeeded"; i++) await delay(10);
    assert.equal(runs.get(run.id).status, "succeeded");
    assert.equal(calls, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
