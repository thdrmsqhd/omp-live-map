"use strict";

// PR-14: Workflow 범위(개인·팀·프로젝트). 팀 Workflow 하나를 같은 팀 프로젝트 두 곳에서 실행하고,
// 기존 프로젝트 Workflow 는 v14 이전 뒤 scope='project' 로 남는지 확인한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");

const node = (id, type, config = {}) => ({ id, type, label: id, ...config });
const edge = (from, to, port) => ({ from, to, port });
const agentGraph = (name, harness) => ({ name, nodes: [node("s", "start"),
  node("w", "agent", { definition: harness, instruction: "Implement the fixture" }), node("z", "end")],
edges: [edge("s", "w"), edge("w", "z")] });

function setup(db) {
  const insert = db.prepare("INSERT INTO project VALUES (?,?,?,?,0)");
  for (const id of ["a", "b", "c"]) insert.run(id, "/tmp/scope-" + id, id.toUpperCase(), "main");
  db.prepare("INSERT INTO harness_team VALUES ('platform')").run();
  db.prepare("INSERT INTO project_team VALUES ('a','platform'),('b','platform')").run();
  const definitions = catalog(db);
  const harness = (owner) => {
    const model = definitions.saveDefinition({ ...owner, kind: "model", payload: { name: "M", provider: "anthropic", model: "fake" } });
    return definitions.saveDefinition({ ...owner, kind: "harness", payload: { name: "H", adapter: "claude", model: model.id, role: "dev" } });
  };
  return { definitions, workflows: workflowCatalog(db, definitions), team: harness({ scope: "team", team: "platform" }),
    local: harness({ project: "a" }) };
}

test("a team workflow is visible to every project of the team and runs pin their start version per project", () => {
  const db = openDatabase(":memory:");
  try {
    const { definitions, workflows, team, local } = setup(db);
    assert.throws(() => workflows.save({ project: "a", scope: "team", payload: agentGraph("team flow", local.id) }),
      /wrong project or kind/, "a team workflow cannot pin a project-only harness");
    const shared = workflows.save({ project: "a", scope: "team", payload: agentGraph("team flow", team.id) });
    assert.equal(shared.scope, "team");
    assert.equal(shared.team, "platform");
    assert.ok(workflows.list("b").some(({ id }) => id === shared.id), "same team project sees it");
    assert.equal(workflows.list("c").some(({ id }) => id === shared.id), false, "other projects do not");
    assert.throws(() => workflows.get("c", shared.id), /not found/);
    const personalModel = definitions.saveDefinition({ scope: "personal", kind: "model", payload: { name: "PM", provider: "anthropic", model: "fake" } });
    const personalHarness = definitions.saveDefinition({ scope: "personal", kind: "harness",
      payload: { name: "P", adapter: "claude", role: "dev", model: personalModel.id } });
    const personal = workflows.save({ project: "c", scope: "personal", payload: agentGraph("mine", personalHarness.id) });
    assert.ok(workflows.list("a").some(({ id }) => id === personal.id), "personal workflows follow the user");
    assert.throws(() => workflows.save({ project: "b", id: shared.id, version: 1, scope: "project", payload: shared.payload }), /immutable/);

    const runs = workflowRuns(db, definitions, workflows);
    const start = (project, key) => runs.create({ project, workflow: shared.id, version: 1, title: "run " + project,
      timeoutMs: 1000, budgetCents: 0 }, key).run;
    const first = start("a", "k-a");
    const edited = workflows.save({ project: "b", id: shared.id, version: 1, payload: { ...shared.payload, name: "team flow v2" } });
    assert.equal(edited.version, 2);
    const second = start("b", "k-b");
    assert.equal(first.project, "a");
    assert.equal(second.project, "b");
    assert.equal(runs.get(first.id).version, 1, "a run keeps the version it started with");
    assert.deepEqual(runs.list("a").map(({ id }) => id), [first.id]);
    assert.deepEqual(runs.list("b").map(({ id }) => id), [second.id]);
    assert.throws(() => runs.create({ project: "c", workflow: shared.id, version: 2, title: "x", timeoutMs: 1000, budgetCents: 0 }, "k-c"), /not found/);
  } finally { db.close(); }
});

test("v13 project workflows migrate to scope='project' and runs gain their project", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-v14-"));
  const file = path.join(directory, "engineering.sqlite");
  try {
    let db = openDatabase(file);
    const { workflows, local } = setup(db);
    const saved = workflows.save({ project: "a", payload: agentGraph("legacy", local.id) });
    db.prepare(`INSERT INTO workflow_run (id,workflow,version,title,status,created,deadline,budget,idempotency_key,request_hash,project)
      VALUES ('r1',?,1,'old','succeeded',1,2,0,'old-key','h','a')`).run(saved.id);
    // v13 모양으로 되돌린다: workflow 는 project NOT NULL 테이블, workflow_run 에는 project 가 없다.
    db.exec(`PRAGMA foreign_keys=OFF;
      CREATE TABLE old_workflow (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES project(id), name TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0), UNIQUE (project, name)) STRICT;
      INSERT INTO old_workflow SELECT id,project,name,version FROM workflow;
      DROP TABLE workflow; ALTER TABLE old_workflow RENAME TO workflow;
      DROP INDEX workflow_run_project; ALTER TABLE workflow_run DROP COLUMN project;
      PRAGMA user_version=13;`);
    db.close();
    db = openDatabase(file);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 15);
      assert.ok(fs.existsSync(file + ".v13.bak"));
      assert.deepEqual({ ...db.prepare("SELECT scope,project,team FROM workflow WHERE id=?").get(saved.id) },
        { scope: "project", project: "a", team: null });
      assert.equal(db.prepare("SELECT project FROM workflow_run WHERE id='r1'").get().project, "a");
      assert.equal(db.prepare("PRAGMA foreign_key_check").get(), undefined);
      assert.equal(db.prepare("SELECT count(*) AS n FROM workflow_version WHERE workflow=?").get(saved.id).n, 1, "versions survive");
    } finally { db.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
