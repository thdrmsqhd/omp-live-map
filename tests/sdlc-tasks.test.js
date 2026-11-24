"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../server/engineering/database");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");
const { workflowEngine } = require("../server/engineering/workflow-engine");
const { sdlcTasks } = require("../server/engineering/sdlc-tasks");

test("Task runs pin workflow and instructions and move the board through approval to completion", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-sdlc-task-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    const project = db.prepare("INSERT INTO project VALUES (?,?,?,?,0)");
    project.run("one", directory, "Fixture", "main");
    project.run("two", path.join(directory, "other"), "Other project", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions), tasks = sdlcTasks(db, definitions, workflows);
    const runs = workflowRuns(db, definitions, workflows, tasks);
    const engine = workflowEngine(runs, workflows, definitions, {}, {});
    const definition = { name: "Flow", nodes: [
      { id: "s", type: "start", label: "Start" }, { id: "a", type: "approval", label: "Review", prompt: "Check requirement" },
      { id: "e", type: "end", label: "End" },
    ], edges: [{ from: "s", to: "a" }, { from: "a", to: "e", port: "approved" }] };
    const flow = workflows.save({ project: "one", payload: definition });
    const form = { project: "one", title: "Implement fixture", instruction: "Preserve regression behavior", workflow: flow.id, version: 1 };
    const task = tasks.save(form);
    assert.throws(() => tasks.save({ ...form, project: "two" }), /Workflow version not found/);
    assert.equal(task.status, "backlog");
    const input = { task: task.id, timeoutMs: 30000, budgetCents: 0 };
    assert.throws(() => engine.start(input, "draft"), /must be Ready/);
    tasks.move(task.id, "ready", 1);
    assert.throws(() => tasks.move(task.id, "backlog", 1), /changed/);
    workflows.save({ project: "one", id: flow.id, version: 1, payload: { ...definition, name: "Renamed" } });
    const run = engine.start(input, "ready");
    assert.equal(run.version, 1);
    assert.equal(run.status, "waiting_approval");
    assert.equal(runs.taskInstruction(run.id), form.instruction);
    assert.equal(tasks.get(task.id).status, "waiting_approval");
    assert.equal(tasks.list("one")[0].latest_run, run.id);
    assert.equal(engine.start(input, "ready").id, run.id);
    assert.throws(() => tasks.move(task.id, "ready", tasks.get(task.id).revision), /active workflow/);
    await engine.decide(run.id, "a", "approved", "reviewed");
    assert.equal(tasks.get(task.id).status, "completed");
    assert.equal(runs.get(run.id).sdlc_task, task.id);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stage settings and delivery reconcile an uncertain PR and gate the release on CI", async () => {
  const { sdlcStages } = require("../server/engineering/sdlc-stages");
  const { workflowDelivery } = require("../server/engineering/workflow-delivery");
  const { workflowStaging } = require("../server/engineering/workflow-staging");
  const { workflowObservability } = require("../server/engineering/workflow-observability");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-delivery-test-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Repo", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const workflow = workflows.save({ project: "one", payload: { name: "fixture",
      nodes: [{ id: "s", type: "start", label: "Start" }, { id: "e", type: "end", label: "End" }], edges: [{ from: "s", to: "e" }] } });
    const stages = sdlcStages(db, definitions, workflows);
    stages.save({ project: "one", status: "ready", label: "구현 준비", position: 0, workflow: workflow.id, version: 1 });
    assert.equal(stages.list("one").find(({ status }) => status === "ready").workflow_version, 1);
    const runs = workflowRuns(db, definitions, workflows);
    const run = runs.create({ project: "one", workflow: workflow.id, version: 1, title: "Fixture", timeoutMs: 30000,
      budgetCents: 0 }, "delivery-test").run;
    const workspace = path.join(directory, run.id);
    fs.mkdirSync(workspace);
    runs.workspace(run.id, workspace);
    runs.change(run.id, ["queued"], "succeeded");
    const commit = "1".repeat(40), repo = "example/fixture";
    let creates = 0, dispatches = 0, posted, dispatched, ci = "failure";
    const gh = async (endpoint, method, fields) => {
      if (endpoint.includes("/git/ref/heads/")) return { object: { sha: commit } };
      if (endpoint.endsWith("/pulls") && method === "POST") {
        creates++;
        posted = { number: 42, html_url: "https://github.com/example/fixture/pull/42",
          head: { sha: commit, ref: "feature/workflow", repo: { full_name: repo } },
          base: { ref: "main", repo: { full_name: repo } } };
        throw new Error("connection lost after GitHub posted the PR");
      }
      if (endpoint.endsWith("/pulls")) return posted ? [posted] : [];
      if (endpoint.endsWith("/pulls/42")) return posted;
      if (endpoint.includes("/check-runs")) return { total_count: 1, check_runs: [{ status: "completed", conclusion: ci }] };
      if (endpoint.includes("/status")) return { total_count: 0, state: "pending" };
      if (endpoint.includes("/contents/")) return { type: "file", path: ".github/workflows/omp-staging.yml" };
      if (endpoint.endsWith("/dispatches")) {
        dispatches++;
        assert.equal(fields.inputs.environment, "staging");
        assert.equal(fields.inputs.approved_sha, commit);
        dispatched = { id: 765, head_sha: commit, head_branch: "feature/workflow", display_title: "omp-" + run.id,
          html_url: "https://github.com/example/fixture/actions/runs/765", conclusion: "success" };
        return null;
      }
      if (endpoint.endsWith("/runs")) return { workflow_runs: dispatched ? [dispatched] : [] };
      throw new Error("Unexpected endpoint " + endpoint);
    };
    const gitCall = async (_, args) => {
      if (args[0] === "rev-parse") return commit;
      if (args[0] === "remote") return "git@github.com:example/fixture.git";
      return "";
    };
    const delivery = workflowDelivery(db, runs, definitions, directory, gh, gitCall);
    const staging = workflowStaging(db, delivery, gh);
    await assert.rejects(delivery.createPR(run.id), /Approve/);
    await delivery.approve(run.id, "feature/workflow");
    await assert.rejects(delivery.createPR(run.id), /connection lost/);
    assert.equal(delivery.get(run.id).state, "creating");
    assert.equal((await delivery.createPR(run.id)).pr_number, 42);
    assert.equal(creates, 1);
    await assert.rejects(delivery.approveRelease(run.id), /CI checks/);
    await assert.rejects(staging.dispatch(run.id, "staging"), /Approve the release/);
    ci = "success";
    assert.ok((await delivery.approveRelease(run.id)).release_approved);
    await assert.rejects(async () => staging.dispatch(run.id, "production"), /Choose test or staging/);
    assert.equal((await staging.dispatch(run.id, "staging")).state, "dispatched");
    assert.equal((await staging.dispatch(run.id, "staging")).workflow_run, 765);
    assert.equal(dispatches, 1);
    const observation = workflowObservability(db, runs, directory);
    assert.ok(observation.timeline(run.id).some(({ kind }) => kind === "workflow.release.approved"));
    assert.deepEqual(observation.dashboard("one").states.map(({ status, count }) => ({ status, count })),
      [{ status: "succeeded", count: 1 }]);
  } finally {
    db.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test("the project cap reserves budget across both V2 Loop and V3 Workflow launches", () => {
  const { projectBudget } = require("../server/engineering/project-budget");
  const { runStore } = require("../server/engineering/run-store");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-quota-test-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Quota", "main");
    const definitions = catalog(db);
    const graph = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, graph);
    const legacyRuns = runStore(db, definitions);
    const quota = projectBudget(db);
    const flow = graph.save({ project: "one", payload: { name: "Smoke",
      nodes: [{ id: "s", type: "start", label: "Start" }, { id: "e", type: "end", label: "End" }], edges: [{ from: "s", to: "e" }] } });
    const res = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "fixture", model: "fixture" } });
    const harness = definitions.saveDefinition({ project: "one", kind: "harness",
      payload: { name: "H", adapter: "claude", model: res.id, role: "team" } });
    const loop = definitions.saveDefinition({ project: "one", kind: "loop", payload: {
      name: "L", harness: harness.id, attempts: 2, timeoutMs: 7000, budgetCents: 70,
      checks: [{ command: "node", args: ["--test"], code: 0 }],
    } });
    quota.save("one", { cap: 100, days: 30 });
    const v3 = { project: "one", workflow: flow.id, version: 1, title: "Graph", timeoutMs: 7000, budgetCents: 50 };
    const v2 = { project: "one", definition: loop.id, title: "Loop", instruction: "Review fixture" };
    const run = runs.create(v3, "graph").run;
    assert.equal(quota.get("one").committed, 50);
    assert.throws(() => legacyRuns.create(v2, "loop"), /budget/);
    runs.change(run.id, ["queued"], "cancelled");
    legacyRuns.create(v2, "loop");
    assert.equal(quota.get("one").committed, 70);
    assert.throws(() => runs.create(v3, "too-much"), /budget/);
  } finally {
    db.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
