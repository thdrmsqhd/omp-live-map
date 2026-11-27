"use strict";

// 한 맵의 서버 쪽: 단계 ↔ 세션 연결(task-map), 서랍의 저장 범위('이 Task만' 사본 / 템플릿), Workflow 편집(넣기·순서·지우기).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { workflowRuns } = require("../server/engineering/workflow-runs");
const { sdlcTasks } = require("../server/engineering/sdlc-tasks");
const { taskMap, stageSessions } = require("../server/engineering/task-map");
const { taskLocal, isTaskLocalName } = require("../server/engineering/task-local");
const workflowLive = require("../server/engineering/workflow-live");

const SESSION_A = "7f1c2a9e-1111-4c1d-9a00-000000000001";
const SESSION_B = "7f1c2a9e-2222-4c1d-9a00-000000000002";

function setup() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("p", path.resolve("fixture-root"), "Fixture", "main");
  const definitions = catalog(db), workflows = workflowCatalog(db, definitions), tasks = sdlcTasks(db, definitions, workflows);
  const flowRuns = workflowRuns(db, definitions, workflows, tasks);
  const model = definitions.saveDefinition({ scope: "personal", kind: "model", payload: { name: "M", provider: "anthropic", model: "claude-haiku-5-5" } });
  const other = definitions.saveDefinition({ scope: "personal", kind: "model", payload: { name: "M2", provider: "anthropic", model: "claude-sonnet-5-5" } });
  const harness = definitions.saveDefinition({ scope: "personal", kind: "harness", payload: { name: "Author", adapter: "claude", model: model.id, role: "설계" } });
  const loop = definitions.saveDefinition({ scope: "personal", kind: "loop", payload: { name: "Impl", harness: harness.id, attempts: 2,
    timeoutMs: 60000, budgetCents: 100, checks: [{ command: "node", args: ["--test"], code: 0 }] } });
  const payload = { name: "Flow", nodes: [
    { id: "s", type: "start", label: "Start" },
    { id: "plan", type: "agent", label: "계획", definition: harness.id, instruction: "계획을 쓴다", outputs: [{ name: "plan", path: ".workflow-output/plan.md" }] },
    { id: "work", type: "loop", label: "구현", definition: loop.id, instruction: "구현한다", inputs: [{ name: "plan", source: "plan", artifact: "plan" }] },
    { id: "ok", type: "approval", label: "승인", prompt: "결과를 보세요" },
    { id: "e", type: "end", label: "End" }],
  edges: [{ from: "s", to: "plan" }, { from: "plan", to: "work" }, { from: "work", to: "ok" }, { from: "ok", to: "e", port: "approved" }] };
  const flow = workflows.save({ project: "p", payload });
  return { db, definitions, workflows, tasks, flowRuns, flow, model, other, harness, loop,
    edits: taskLocal(db, { definitions, workflows, tasks }) };
}

test("stageSessions joins attempts, archived retries and the live session of a running stage", () => {
  const sessions = stageSessions(
    [{ node: "plan", outcome: { attempts: [{ sessionId: SESSION_A, agent: "claude", model: "m", costCents: 12 }] } }],
    [{ node: "plan", attempt: 1, outcome: { attempts: [{ sessionId: SESSION_B }] } }],
    { work: { sessionId: SESSION_B, attempt: 2 } });
  assert.deepEqual(sessions.get("plan").map(({ sessionId, retry }) => [sessionId, retry]), [[SESSION_B, 1], [SESSION_A, 0]]);
  assert.equal(sessions.get("work")[0].live, true);
  assert.equal(sessions.get("work")[0].attempt, 2);
});

test("snapshot nodes carry the runtime session id the workflow stages record", () => {
  const { sessionIdOf } = require("../server/snapshot");
  assert.equal(sessionIdOf({ harness: "omp", id: SESSION_A, file: "C:/x/2026-11-28T00-00-00-000Z_" + SESSION_A + ".jsonl" }), SESSION_A);
  assert.equal(sessionIdOf({ harness: "omp", file: "C:/x/2026-11-28T00-00-00-000Z_" + SESSION_B + ".jsonl" }), SESSION_B);
  assert.equal(sessionIdOf({ harness: "claude", file: "C:/claude/projects/C--w/" + SESSION_A + ".jsonl" }), SESSION_A);
});

test("task-map lists stages with harness/loop chips, run status, waiting approval and linked sessions", () => {
  const { db, definitions, workflows, tasks, flowRuns, flow } = setup();
  try {
    const task = tasks.save({ project: "p", text: "로그인 고치기", workflow: flow.id, version: flow.version });
    const backlog = tasks.save({ project: "p", text: "나중 일", workflow: flow.id, version: flow.version });
    tasks.prepareRun(task.id);
    const { run } = flowRuns.create({ task: task.id, timeoutMs: 60000, budgetCents: 0 }, "k1");
    flowRuns.change(run.id, ["queued"], "running");
    flowRuns.begin(run.id, "plan");
    flowRuns.finish(run.id, "plan", "succeeded", { attempts: [{ sessionId: SESSION_A, agent: "claude", model: "claude-haiku-5-5", costCents: 25 }] });
    flowRuns.begin(run.id, "work");
    flowRuns.finish(run.id, "work", "succeeded", { attempts: [{ sessionId: SESSION_B, costCents: 5 }] });
    flowRuns.ask(run.id, "ok", "결과를 보세요", []);
    const map = taskMap({ definitions, workflows, tasks, flowRuns, workflowLive }, "p");
    assert.equal(map.project.name, "Fixture");
    const row = map.tasks.find(({ id }) => id === task.id);
    assert.equal(row.status, "waiting_approval");
    assert.deepEqual(row.stages.map(({ id, status }) => [id, status]), [["plan", "succeeded"], ["work", "succeeded"], ["ok", "waiting_approval"]]);
    assert.equal(row.stages[0].harness.name, "Author");
    assert.equal(row.stages[0].harness.model.model, "claude-haiku-5-5");
    assert.equal(row.stages[1].loop.attempts, 2);
    assert.equal(row.stages[1].harness.name, "Author", "a loop stage shows the harness it runs");
    assert.deepEqual(row.stages[0].sessions.map(({ sessionId }) => sessionId), [SESSION_A]);
    assert.deepEqual(row.stages[1].sessions.map(({ sessionId }) => sessionId), [SESSION_B]);
    assert.equal(row.stages[2].waiting.prompt, "결과를 보세요");
    assert.equal(row.run.costCents, 30);
    const idle = map.tasks.find(({ id }) => id === backlog.id);
    assert.equal(idle.run, null);
    assert.ok(idle.stages.every(({ status, sessions }) => status === "pending" && sessions.length === 0), "backlog stages have not run yet");
  } finally { db.close(); }
});

test("drawer scope '이 Task만' edits a task-local copy and '템플릿' versions the shared template", () => {
  const { db, definitions, workflows, tasks, flow, harness, loop, other, edits } = setup();
  try {
    const task = tasks.save({ project: "p", text: "A", workflow: flow.id, version: flow.version });
    const neighbour = tasks.save({ project: "p", text: "B", workflow: flow.id, version: flow.version });
    // 1. 이 Task만(기본): 사본 Workflow 가 생기고 Task 는 사본에 고정된다. 템플릿·이웃 Task 는 그대로다.
    const first = edits.editStage({ task: task.id, node: "plan", stage: { instruction: "이 Task 만의 계획" } });
    assert.equal(first.scope, "task");
    assert.notEqual(first.workflow.id, flow.id);
    assert.ok(isTaskLocalName(first.workflow.name, task.id));
    assert.equal(tasks.get(task.id).workflow, first.workflow.id);
    assert.equal(workflows.get("p", flow.id).version, 1, "template is untouched");
    assert.equal(tasks.get(neighbour.id).workflow, flow.id);
    // 2. 같은 Task 를 다시 고치면 같은 사본의 새 버전이다. 하네스를 고치면 하네스 사본이 생긴다.
    const second = edits.editStage({ task: task.id, node: "plan", harness: { role: "이 Task 설계자", model: other.id } });
    assert.equal(second.workflow.id, first.workflow.id);
    assert.equal(second.workflow.version, 2);
    const localNode = workflows.get("p", second.workflow.id).payload.nodes.find(({ id }) => id === "plan");
    const localHarness = definitions.versionOf(localNode.definition, localNode.version);
    assert.notEqual(localHarness.id, harness.id);
    assert.ok(isTaskLocalName(localHarness.name, task.id));
    assert.equal(localHarness.payload.role, "이 Task 설계자");
    assert.equal(definitions.versionOf(harness.id).payload.role, "설계", "shared harness keeps its role");
    // 3. 루프 한도: 사본 루프.
    const third = edits.editStage({ task: task.id, node: "work", loop: { attempts: 4 } });
    const workNode = workflows.get("p", third.workflow.id).payload.nodes.find(({ id }) => id === "work");
    assert.equal(definitions.versionOf(workNode.definition, workNode.version).payload.attempts, 4);
    assert.equal(definitions.versionOf(loop.id).payload.attempts, 2);
    // 4. 템플릿: 원본 Workflow 새 버전, 그 Task 는 새 버전에 고정, 이웃 Task 는 예전 버전 그대로.
    const shared = edits.editStage({ task: neighbour.id, node: "ok", scope: "template", stage: { prompt: "꼼꼼히 보세요" } });
    assert.equal(shared.workflow.id, flow.id);
    assert.equal(shared.workflow.version, 2);
    assert.equal(tasks.get(neighbour.id).workflow_version, 2);
    assert.equal(workflows.get("p", flow.id).payload.nodes.find(({ id }) => id === "ok").prompt, "꼼꼼히 보세요");
  } finally { db.close(); }
});

test("Workflow 편집 inserts, reorders and deletes stages and drops inputs that lost their producer", () => {
  const { db, workflows, tasks, flow, harness, edits } = setup();
  try {
    const task = tasks.save({ project: "p", text: "A", workflow: flow.id, version: flow.version });
    const inserted = edits.editWorkflow({ task: task.id, stages: [{ id: "plan" }, { id: "review", type: "agent", label: "리뷰", definition: harness.id }, { id: "work" }, { id: "ok" }] });
    let saved = workflows.get("p", inserted.workflow.id).payload;
    assert.deepEqual(saved.nodes.map(({ id }) => id), ["s", "plan", "review", "work", "ok", "e"]);
    assert.deepEqual(saved.edges.at(-1), { from: "ok", to: "e", port: "approved" });
    // work 를 plan 앞으로 옮기면 plan 산출물을 받던 입력은 빠진다. 그다음 review 를 지운다.
    const moved = edits.editWorkflow({ task: task.id, stages: [{ id: "work" }, { id: "plan" }, { id: "ok" }] });
    saved = workflows.get("p", moved.workflow.id).payload;
    assert.equal(moved.workflow.id, inserted.workflow.id, "the same task-local copy is versioned");
    assert.deepEqual(saved.nodes.map(({ id }) => id), ["s", "work", "plan", "ok", "e"]);
    assert.deepEqual(saved.nodes.find(({ id }) => id === "work").inputs, []);
    assert.equal(workflows.get("p", flow.id).version, 1);
    // 라이브러리 지우기: Task 가 쓰는 사본은 못 지우고, 아무도 쓰지 않는 템플릿은 지운다.
    assert.throws(() => edits.removeWorkflow("p", moved.workflow.id), /쓰는 Task/);
    assert.deepEqual(edits.removeWorkflow("p", flow.id), { removed: true });
    assert.throws(() => workflows.get("p", flow.id), /not found/);
  } finally { db.close(); }
});
