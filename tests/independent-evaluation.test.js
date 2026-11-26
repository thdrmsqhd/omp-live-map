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
const { independentEvaluation } = require("../server/engineering/independent-evaluation");

test("independent evaluation scores a sealed rubric without changing the completed run", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-independent-eval-"));
  const worktrees = path.join(directory, "worktrees");
  fs.mkdirSync(worktrees);
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Fixture", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const runs = workflowRuns(db, definitions, workflows);
    const engine = workflowEngine(runs, workflows, definitions, {
      async verify([{ command }], workspace) {
        fs.writeFileSync(path.join(workspace, "answer.json"), JSON.stringify({ summary: { count: 2 } }));
        return [{ command, passed: true }];
      },
    }, { async create(_project, run) {
      const workspace = path.join(worktrees, run.id);
      fs.mkdirSync(workspace);
      return workspace;
    } });
    const saved = workflows.save({ project: "one", payload: { name: "eval target", nodes: [
      { id: "s", label: "s", type: "start" },
      { id: "make", label: "make", type: "command", check: { command: "make", args: [] }, outputs: [{ name: "answer", path: "answer.json" }] },
      { id: "e", label: "e", type: "end", inputs: [{ name: "answer", source: "make", artifact: "answer" }] },
    ], edges: [{ from: "s", to: "make" }, { from: "make", to: "e" }] } });
    const run = engine.start({ project: "one", workflow: saved.id, version: 1, title: "score", timeoutMs: 3000, budgetCents: 100 }, "eval-key");
    for (let i = 0; i < 100 && runs.get(run.id).status !== "succeeded"; i++) await delay(10);
    assert.equal(runs.get(run.id).status, "succeeded");
    const before = JSON.stringify(runs.get(run.id));
    const runRow = () => db.prepare("SELECT * FROM workflow_run WHERE id=?").get(run.id);
    const nodeRows = () => db.prepare("SELECT * FROM workflow_node WHERE run=? ORDER BY node").all(run.id);
    const beforeRow = runRow();
    const beforeNodes = nodeRows();
    const evaluation = independentEvaluation({ db, directory, workspaceRoot: worktrees, runs, definitions, workflows });
    const rubric = evaluation.post({ operation: "seal", project: "one", workflow: saved.id, rubric: { name: "count", cases: [{ path: "/summary/count", operator: "equals", value: 2 }] } });
    const result = await evaluation.post({ operation: "evaluate", project: "one", id: run.id, node: "make", artifact: "answer", rubricDigest: rubric.digest });
    assert.equal(result.score, 100);
    assert.equal(result.passed, 1);
    assert.equal(JSON.stringify(runs.get(run.id)), before);
    assert.deepEqual(runRow(), beforeRow);
    assert.deepEqual(nodeRows(), beforeNodes);
    assert.equal(JSON.stringify(runs.nodes(run.id)).includes(rubric.digest), false);
    evaluation.close();
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
