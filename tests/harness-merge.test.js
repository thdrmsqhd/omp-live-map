"use strict";

// 에이전트 프로필 → 하네스 합치기. 같은 이름 하네스는 그대로 쓰고, 없으면 프로필 내용으로 개인 하네스를 만든다.
// Workflow 의 프로필 노드(Agent ← Profile)는 Agent 가 그 하네스를 직접 고정하도록 바뀐다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { mergeProfilesIntoHarnesses } = require("../server/engineering/harness-merge");

function profileRow(db, id, payload, version = 1) {
  db.prepare("INSERT INTO definition(id,scope,project,team,kind,name,version) VALUES (?,?,?,?,?,?,?)")
    .run(id, "personal", null, null, "profile", payload.name, version);
  for (let v = 1; v <= version; v++) db.prepare("INSERT INTO definition_version VALUES (?,?,?)").run(id, v, JSON.stringify(payload));
}

test("profiles become harnesses, workflow Agent←Profile links pin the harness, and the profile rows go away", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-merge-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", directory, "Merge", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const model = definitions.saveDefinition({ scope: "personal", kind: "model",
      payload: { name: "기본 · Claude Fable 5.2", provider: "anthropic", model: "claude-fable-5-2" } });
    const existing = definitions.saveDefinition({ scope: "personal", kind: "harness",
      payload: { name: "기본 · 코드 리뷰", adapter: "claude", model: model.id, role: "리뷰" } });
    profileRow(db, "p-review", { name: "기본 · 코드 리뷰", adapter: "claude", model: "claude-fable-5-2", provider: "", role: "중복", instructions: "" });
    profileRow(db, "p-author", { name: "작성자", adapter: "claude", model: "claude-sonnet-4-5", provider: "", role: "문서 작성", instructions: "근거를 적는다." }, 2);
    // 저장된 Workflow 버전에 프로필 노드가 남아 있다(예전 화면이 저장한 모양).
    const payload = { name: "Old review", nodes: [
      { id: "start", label: "Start", type: "start", x: 0, y: 0, inputs: [], outputs: [] },
      { id: "profile-1", label: "작성자", type: "profile", x: 0, y: 0, inputs: [], outputs: [], profileId: "p-author", profileVersion: 1 },
      { id: "write", label: "작성", type: "agent", x: 0, y: 0, inputs: [], outputs: [], instruction: "문서를 쓴다." },
      { id: "profile-2", label: "리뷰", type: "profile", x: 0, y: 0, inputs: [], outputs: [], profileId: "p-review", profileVersion: 1 },
      { id: "review", label: "리뷰", type: "agent", x: 0, y: 0, inputs: [], outputs: [], instruction: "검토한다." },
      { id: "end", label: "End", type: "end", x: 0, y: 0, inputs: [], outputs: [] }],
    edges: [{ from: "start", to: "write", port: "next" }, { from: "write", to: "review", port: "next" }, { from: "review", to: "end", port: "next" },
      { from: "profile-1", to: "write", port: "profile" }, { from: "profile-2", to: "review", port: "profile" }] };
    db.prepare("INSERT INTO workflow(id,project,team,scope,name,version) VALUES ('w','one',NULL,'project','Old review',1)").run();
    db.prepare("INSERT INTO workflow_version VALUES ('w',1,?)").run(JSON.stringify(payload));
    const legacy = { current: [{ id: "legacy-1", version: 1, payload: JSON.stringify({ name: "레거시 OMP", adapter: "omp", provider: "fake", model: "fake-2", role: "점검", instructions: "읽기만" }) }], history: [] };

    const result = mergeProfilesIntoHarnesses(db, definitions, legacy);
    assert.deepEqual(result, { harnesses: 2, workflows: 1 });
    const harnesses = definitions.definitions(null, "personal").filter(({ kind }) => kind === "harness");
    assert.deepEqual(harnesses.map(({ name }) => name).sort(), ["기본 · 코드 리뷰", "레거시 OMP", "작성자"]);
    const author = harnesses.find(({ name }) => name === "작성자");
    assert.equal(author.payload.role, "문서 작성");
    assert.equal(author.payload.instructions, "근거를 적는다.");
    assert.equal(definitions.dependency(author).payload.model, "claude-sonnet-4-5");
    const omp = harnesses.find(({ name }) => name === "레거시 OMP");
    assert.equal(omp.payload.adapter, "omp");
    assert.equal(definitions.dependency(omp).payload.provider, "fake");

    const migrated = workflows.get("one", "w", 1).payload;
    assert.equal(migrated.nodes.some(({ type }) => type === "profile"), false);
    assert.equal(migrated.edges.some(({ port }) => port === "profile"), false);
    assert.equal(migrated.nodes.find(({ id }) => id === "write").definition, author.id);
    assert.equal(migrated.nodes.find(({ id }) => id === "review").definition, existing.id, "a same-name harness is kept");
    assert.deepEqual(workflows.executionPlan("one", migrated, "w").order, ["start", "write", "review", "end"]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM workflow_definition WHERE workflow='w'").get().n, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM definition WHERE kind='profile'").get().n, 0);
    assert.equal(db.prepare("PRAGMA foreign_key_check").get(), undefined);
    assert.deepEqual(mergeProfilesIntoHarnesses(db, definitions, legacy), { harnesses: 0, workflows: 0 }, "runs once");
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the new-session picker lists harnesses and injects role and instructions like profiles did", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-session-harness-"));
  const db = openDatabase(path.join(directory, "engineering.sqlite"));
  const previous = process.env.OMP_MAP_STATE;
  process.env.OMP_MAP_STATE = directory;
  const sessionHarness = require("../server/harness/session-harness");
  try {
    const definitions = catalog(db);
    sessionHarness.useCatalog(() => definitions);
    const model = definitions.saveDefinition({ scope: "personal", kind: "model", payload: { name: "M", provider: "anthropic", model: "claude-haiku-5-5" } });
    const harness = definitions.saveDefinition({ scope: "personal", kind: "harness",
      payload: { name: "빠른 점검", adapter: "claude", model: model.id, role: "점검", instructions: "추측하지 않는다." } });
    const [listed] = sessionHarness.list();
    assert.deepEqual([listed.name, listed.adapter, listed.model, listed.role], ["빠른 점검", "claude", "claude-haiku-5-5", "점검"]);
    const chosen = sessionHarness.resolve({ id: harness.id, version: harness.version });
    assert.equal(sessionHarness.systemPrompt(chosen), "Role: 점검\n\n추측하지 않는다.");
    definitions.saveDefinition({ scope: "personal", kind: "harness", id: harness.id, version: 1, payload: { ...harness.payload, instructions: "v2" } });
    assert.throws(() => sessionHarness.resolve({ id: harness.id, version: 1 }), /변경되었거나/);
    sessionHarness.assign(path.join(directory, "session.jsonl"), chosen);
    assert.equal(sessionHarness.assigned(path.join(directory, "session.jsonl"), "claude").instructions, "추측하지 않는다.");
  } finally {
    sessionHarness.useCatalog(null);
    sessionHarness.close();
    if (previous === undefined) delete process.env.OMP_MAP_STATE; else process.env.OMP_MAP_STATE = previous;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
