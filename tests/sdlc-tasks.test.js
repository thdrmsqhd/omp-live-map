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
