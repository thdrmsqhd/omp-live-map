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
const { workflowObservability } = require("../server/engineering/workflow-observability");

test("a workflow executes the selected branch, persists approval and never replays an uncertain node", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-flow-run-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const liveMap = workflowObservability(db, runs, directory).liveMapRuns;
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
    assert.deepEqual(liveMap(), {
      total: 1, attention: [{ id: run.id, title: "try", status: "waiting_approval", project: "Fixture", node: "a" }], recent: [],
    });
    assert.deepEqual(observed, ["first-check", "make-report"]);
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "a").outcome.prompt, "Review fallback");
    await assert.rejects(engine.decide(run.id, "a", "rejected", ""), /approval reason/);
    fs.writeFileSync(path.join(directory, "report.txt"), "modified after review");
    await assert.rejects(engine.decide(run.id, "a", "approved", "reviewed"), /artifact changed/);
    assert.equal(runs.get(run.id).status, "waiting_approval");
    fs.writeFileSync(path.join(directory, "report.txt"), "reviewed content");
    await engine.decide(run.id, "a", "approved", "reviewed");
    await waitFor(run.id, "succeeded");
    assert.deepEqual(JSON.parse(JSON.stringify(liveMap())), {
      total: 0, attention: [], recent: [{ id: run.id, title: "try", status: "succeeded", project: "Fixture" }],
    });
    assert.deepEqual(observed, ["first-check", "make-report", "after-approval"]);
    await assert.rejects(engine.decide(run.id, "a", "approved", "duplicate"), /not pending/);

    const interrupted = runs.create(input, "uncertain").run;
    runs.change(interrupted.id, ["queued"], "running");
    runs.begin(interrupted.id, "first-check");
    runs.recover();
    assert.equal(runs.get(interrupted.id).status, "interrupted");
    assert.equal(runs.nodes(interrupted.id)[0].status, "interrupted");
    assert.equal(liveMap().attention[0].node, "first-check");
    db.prepare("UPDATE project SET archived=1 WHERE id=?").run("one");
    assert.deepEqual(liveMap(), { total: 0, attention: [], recent: [] });
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

test("parallel workflow branches run in distinct Git worktrees and publish outputs before Join", { timeout: 12000 }, async () => {
  const { execFileSync } = require("node:child_process");
  const { worktrees } = require("../server/engineering/worktree");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-flow-parallel-"));
  const root = path.join(directory, "repo");
  fs.mkdirSync(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(root, "seed.txt"), "seed");
  git("add", "seed.txt");
  git("-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-m", "fixture");
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", root, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    let release;
    const bothStarted = new Promise((resolve) => { release = resolve; });
    const seen = [];
    const engine = workflowEngine(runs, workflows, definitions, {
      async verify([{ command }], location, signal) {
        assert.equal(fs.readFileSync(path.join(location, "seed.txt"), "utf8"), "seed");
        if (command === "verify-join") {
          assert.equal(fs.readFileSync(path.join(location, "left.txt"), "utf8"), "left");
          assert.equal(fs.readFileSync(path.join(location, "right.txt"), "utf8"), "right");
        } else {
          seen.push(location);
          if (seen.length === 2) release();
          await Promise.race([bothStarted, delay(3000, null, { signal, ref: false }).then(() => { throw Error("Branches did not run concurrently"); })]);
          const sibling = command === "left" ? "right" : "left";
          assert.equal(fs.existsSync(path.join(location, sibling + ".txt")), false);
          fs.writeFileSync(path.join(location, command + ".txt"), command);
        }
        return [{ command, passed: true }];
      },
    }, worktrees(path.join(directory, "worktrees")));
    const n = (id, type, config = {}) => ({ id, type, label: id, ...config });
    const command = (id, outputs = []) => n(id,"command",{ check: { command: id,args: [] }, outputs });
    const a = (from, to) => ({ from,to });
    const plan = workflows.save({ project: "one", payload: { name: "isolated parallel", nodes: [
      n("s", "start"), n("p", "parallel"), command("left", [{ name: "left", path: "left.txt" }]),
      command("right", [{ name: "right", path: "right.txt" }]), n("j", "join"), command("verify-join"), n("e", "end"),
    ], edges: [a("s","p"),a("p","left"),a("p","right"),a("left","j"),a("right","j"),a("j","verify-join"),a("verify-join","e")] } });
    const run = engine.start({ project: "one", workflow: plan.id, version: 1, title: "parallel", timeoutMs: 10000, budgetCents: 0 }, "parallel-key");
    for (let i = 0; i < 800 && ["running","queued"].includes(runs.get(run.id).status); i++) await delay(10);
    assert.equal(runs.get(run.id).status, "succeeded", JSON.stringify({ run: runs.get(run.id), nodes: runs.nodes(run.id) }));
    assert.equal(new Set(seen).size, 2);
    assert.equal(fs.existsSync(path.join(root, "left.txt")), false);
  } finally {
    db.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test("workflow rework archives the failed verification and returns evidence to the implementation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-flow-rework-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const model = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "test", model: "fake" } });
    const harness = definitions.saveDefinition({ project: "one", kind: "harness",
      payload: { name: "Developer", role: "developer", adapter: "claude", model: model.id } });
    const graph = workflows.save({ project: "one", payload: { name: "Modbus reconnect", nodes: [
      { id: "start", type: "start", label: "Start" },
      { id: "fix", type: "agent", label: "Implement", definition: harness.id, instruction: "Fix reconnect" },
      { id: "test", type: "command", label: "Verify", check: { command: "verify", args: [] } },
      { id: "end", type: "end", label: "End" },
    ], edges: [["start","fix"],["fix","test"],["test","end"]].map(([from,to]) => ({ from,to })) } });
    const prompts = [];
    const engine = workflowEngine(runs, workflows, definitions, {
      requireAdapter() { return { async run({ instruction }) {
        prompts.push(instruction);
        return { costCents: 1, sessionId: "fixture" };
      } }; },
      async verify() { return [{ command: "verify", passed: prompts.length > 1, log: "Reconnect timeout test failed" }]; },
    }, { async create() { return directory; } });
    const run = engine.start({ project: "one", workflow: graph.id, version: 1, title: "Reconnect", timeoutMs: 5000, budgetCents: 20 }, "fix");
    const settle = async () => {
      for (let i = 0; i < 100 && ["queued","running"].includes(runs.get(run.id).status); i++) await delay(10);
    };
    await settle();
    assert.equal(runs.get(run.id).status, "failed");
    engine.retry(run.id, "test", { mode: "rework", restart: "fix", note: "Check reconnect timing" });
    await settle();
    assert.equal(runs.get(run.id).status, "succeeded");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Reconnect timeout test failed/);
    assert.match(prompts[1], /Check reconnect timing/);
    assert.deepEqual(runs.retries(run.id).map(({ node }) => node).sort(), ["fix", "test"]);
    assert.equal(runs.get(run.id).version, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("verification-only retry uses the previous Loop worktree without calling its agent", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-flow-verify-only-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const model = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "test", model: "fake" } });
    const harness = definitions.saveDefinition({ project: "one", kind: "harness",
      payload: { name: "Developer", role: "developer", adapter: "claude", model: model.id } });
    const loop = definitions.saveDefinition({ project: "one", kind: "loop", payload: {
      name: "Modbus", harness: harness.id, attempts: 1, timeoutMs: 2000, budgetCents: 20, checks: [{ command: "check", args: [] }],
    } });
    const graph = workflows.save({ project: "one", payload: { name: "Verify reconnect", nodes: [
      { id: "start", type: "start", label: "Start" },
      { id: "loop", type: "loop", label: "Implement and verify", definition: loop.id, instruction: "Reconnect" },
      { id: "end", type: "end", label: "End" },
    ], edges: [{ from: "start", to: "loop" }, { from: "loop", to: "end" }] } });
    let calls = 0, checks = 0, worktrees = 0;
    const engine = workflowEngine(runs, workflows, definitions, {
      requireAdapter() { return { async run() { calls++; return { costCents: 1 }; } }; },
      async verify(checksToRun, cwd) {
        assert.equal(cwd, directory);
        return checksToRun.map(({ command }) => ({ command, passed: ++checks === 2 }));
      },
    }, { async create() { worktrees++; return directory; } });
    const run = engine.start({ project: "one", workflow: graph.id, version: 1, title: "Test Loop", timeoutMs: 6000, budgetCents: 30 }, "verify-only");
    const settle = async () => {
      for (let i = 0; i < 150 && ["queued","running"].includes(runs.get(run.id).status); i++) await delay(10);
    };
    await settle();
    assert.equal(runs.get(run.id).status, "failed");
    engine.retry(run.id, "loop", { mode: "verify" });
    await settle();
    assert.equal(runs.get(run.id).status, "succeeded");
    assert.equal(runs.nodes(run.id).find(({ node }) => node === "loop").outcome.verificationOnly, true);
    assert.equal(calls, 1);
    assert.equal(checks, 2);
    assert.equal(worktrees, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
