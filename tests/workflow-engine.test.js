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
    const runner = { async verify(checks, workspace) {
      const [{ command }] = checks;
      observed.push(command);
      if (command === "make-report") fs.writeFileSync(path.join(workspace, "report.txt"), "reviewed content");
      return [{ command, passed: command !== "first-check" }];
    } };
    const engine = workflowEngine(runs, workflows, definitions, runner, { async create() { return directory; } });
    const node = (id, type, config = {}) => ({ id, label: id, type, ...config });
    const command = (id) => node(id, "command", { check: { command: id, args: [] } });
    const edge = (from, to, port) => ({ from, to, port });
    const saved = workflows.save({ project: "one", payload: { name: "approval", nodes: [
      node("s", "start"), command("first-check"), node("c", "condition", { source: "first-check", field: "passed", equals: true }),
      node("make-report", "command", { check: { command: "make-report", args: [] }, outputs: [{ name: "report", path: "report.txt" }] }),
      node("a", "approval", { prompt: "Review fallback", inputs: [{ name: "review", source: "make-report", artifact: "report" }] }),
      command("after-approval"), node("e", "end"),
    ], edges: [edge("s","first-check"), edge("first-check","c"), edge("c","e","true"), edge("c","make-report","false"),
      edge("make-report","a"),
      edge("a","after-approval","approved"), edge("after-approval","e")] } });
    const input = { project: "one", workflow: saved.id, version: 1, title: "try", timeoutMs: 3000, budgetCents: 100 };
    const run = engine.start(input, "retry-key");
    assert.equal(engine.start(input, "retry-key").id, run.id);
    const waitFor = async (id, status) => {
      for (let i = 0; i < 100 && runs.get(id).status !== status; i++) await delay(10);
      assert.equal(runs.get(id).status, status);
    };
    await waitFor(run.id, "waiting_approval");
    assert.deepEqual(observed, ["first-check", "make-report"]);
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "a").outcome.prompt, "Review fallback");
    await assert.rejects(engine.decide(run.id, "a", "rejected", ""), /approval reason/);
    fs.writeFileSync(path.join(directory, "report.txt"), "modified after review");
    await assert.rejects(engine.decide(run.id, "a", "approved", "reviewed"), /artifact changed/);
    assert.equal(runs.get(run.id).status, "waiting_approval");
    fs.writeFileSync(path.join(directory, "report.txt"), "reviewed content");
    await engine.decide(run.id, "a", "approved", "reviewed");
    await waitFor(run.id, "succeeded");
    assert.deepEqual(observed, ["first-check", "make-report", "after-approval"]);
    await assert.rejects(engine.decide(run.id, "a", "approved", "duplicate"), /not pending/);

    const interrupted = runs.create(input, "uncertain").run;
    runs.change(interrupted.id, ["queued"], "running");
    runs.begin(interrupted.id, "first-check");
    runs.recover();
    assert.equal(runs.get(interrupted.id).status, "interrupted");
    assert.equal(runs.nodes(interrupted.id)[0].status, "interrupted");
    assert.throws(() => engine.action(interrupted.id, "resume"), /uncertain/);
    assert.deepEqual(observed, ["first-check", "make-report", "after-approval"]);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an artifact digest rejects a hard-linked file", async () => {
  const { artifactDigest } = require("../server/engineering/workflow-artifact");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-artifact-"));
  try {
    fs.writeFileSync(path.join(dir, "original.txt"), "fixture");
    await artifactDigest(dir, "original.txt");
    fs.linkSync(path.join(dir, "original.txt"), path.join(dir, "link.txt"));
    await assert.rejects(artifactDigest(dir, "link.txt"), /regular file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retrying a known failed node keeps successful predecessors and stores its previous result", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-flow-retry-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const seen = [];
    const engine = workflowEngine(runs, workflows, definitions, {
      async verify([{ command }]) {
        seen.push(command);
        return [{ command, passed: command !== "flaky" || seen.length > 2 }];
      },
    }, { async create() { return directory; } });
    const check = (id) => ({ id, type: "command", label: id, check: { command: id, args: [] } });
    const workflow = workflows.save({ project: "one", payload: { name: "retry fixture",
      nodes: [{ id: "s", type: "start", label: "Start" }, check("recorded"), check("flaky"), { id: "e", type: "end", label: "End" }],
      edges: [{ from: "s", to: "recorded" }, { from: "recorded", to: "flaky" }, { from: "flaky", to: "e" }] } });
    const run = engine.start({ project: "one", workflow: workflow.id, version: 1, title: "run",
      timeoutMs: 3000, budgetCents: 0 }, "retry-fixture");
    const waitFor = async (status) => {
      for (let i = 0; i < 100 && runs.get(run.id).status !== status; i++) await delay(10);
      assert.equal(runs.get(run.id).status, status);
    };
    await waitFor("failed");
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "e").status, "skipped");
    engine.retry(run.id, "flaky");
    await waitFor("succeeded");
    assert.deepEqual(seen, ["recorded", "flaky", "flaky"]);
    assert.equal(runs.retries(run.id)[0].outcome.passed, false);
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "e").status, "succeeded");
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
