"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { compileGraph } = require("../server/engineering/graph-definition");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");

const node = (id, type, config = {}) => ({ id, type, label: id, ...config });
const edge = (from, to, port) => ({ from, to, port });
const check = { check: { command: "node", args: ["--test"] } };
const graph = () => ({ name: "branch and join",
  nodes: [
    node("s", "start"), node("p", "parallel"), node("a", "command", { ...check, outputs: [{ name: "report", path: "build/result.json" }] }),
    node("b", "command", check), node("c", "condition", { source: "a", field: "passed", equals: true }),
    node("j", "join"), node("z", "end"),
  ],
  edges: [edge("s", "p"), edge("p", "b"), edge("p", "a"), edge("a", "c"), edge("b", "j"),
    edge("c", "j", "true"), edge("c", "z", "false"), edge("j", "z")],
});

test("workflow planning is deterministic and rejects missing ports, cycles and invalid contracts", () => {
  const { order, document } = compileGraph(graph());
  assert.deepEqual(order, ["s", "p", "a", "b", "c", "j", "z"]);
  assert.deepEqual(compileGraph({ ...graph(), edges: graph().edges.reverse() }).order, order);
  assert.equal(document.nodes.find(({ id }) => id === "a").check.code, 0);
  const missing = graph(); missing.edges = missing.edges.filter((edge) => edge.port !== "false");
  assert.throws(() => compileGraph(missing), /Missing or duplicate output/);
  const cycle = graph();
  cycle.edges.push(edge("j", "j"));
  assert.throws(() => compileGraph(cycle), /Invalid graph connection/);
  const disconnected = graph();
  disconnected.nodes.push(node("d", "parallel"), node("e", "command", check), node("f", "command", check));
  disconnected.edges.push(edge("d", "e"), edge("d", "f"), edge("e", "d"), edge("f", "j"));
  assert.throws(() => compileGraph(disconnected), /cycles or unreachable/);
  const traversal = graph();
  traversal.nodes.find(({ id }) => id === "a").outputs[0].path = "../secrets";
  assert.throws(() => compileGraph(traversal), /workspace-relative/);
  const wrongSource = graph();
  wrongSource.nodes.find(({ id }) => id === "c").source = "b";
  assert.throws(() => compileGraph(wrongSource), /compatible predecessor/);
});

test("handoff schema is optional and rejects unbounded, nonliteral and unknown port values", () => {
  assert.deepEqual(compileGraph(graph()).document.edges[0], { from: "s", to: "p", port: "next" });
  for (const schema of [null, 1, [], { id: "report" }, "", "Report", " report", "report\n", "x/y", "x".repeat(49)]) {
    const payload = graph();
    payload.edges[0].schema = schema;
    assert.throws(() => compileGraph(payload), /Invalid handoff schema ID/);
  }
  const payload = graph();
  payload.edges[0].schema = "x".repeat(48);
  assert.equal(compileGraph(payload).document.edges[0].schema.length, 48);
  // 프로필 연결(port "profile")은 하네스로 합쳐져 없다. 알 수 없는 포트로 거절한다.
  payload.edges[0].port = "profile";
  assert.throws(() => compileGraph(payload), /Invalid graph connection or output port/);
});

test("workflow handoffs validate the exact pinned result file, direct binding, and definition scope", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const insert = db.prepare("INSERT INTO project VALUES (?,?,?,?,0)");
  insert.run("one", "one-root", "Project one", "main");
  insert.run("two", "two-root", "Project two", "main");
  const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
  const model = definitions.saveDefinition({ scope: "personal", kind: "model", payload: { name: "M", provider: "fixture", model: "fake" } });
  const harnessPayload = (name, extra = {}) => ({ name, adapter: "claude", model: model.id, role: name, ...extra });
  const producerPayload = harnessPayload("Writer", { result: { shape: "object", path: "build/result.json", fields: ["evidence"] } });
  const producer = definitions.saveDefinition({ scope: "personal", kind: "harness", payload: producerPayload });
  const consumer = definitions.saveDefinition({ scope: "personal", kind: "harness",
    payload: harnessPayload("Reader", { assets: { inputs: ["evidence"] } }) });
  const loop = definitions.saveDefinition({ project: "one", kind: "loop", payload: {
    name: "Loop", harness: producer.id, attempts: 2, timeoutMs: 1000, budgetCents: 10, checks: [check.check],
  } });
  const handoff = () => ({ name: "Typed handoff", nodes: [node("s", "start"),
    node("writer", "agent", { definition: producer.id, version: 1, instruction: "Write", outputs: [{ name: "report", path: "build/result.json" }] }),
    node("reader", "agent", { definition: consumer.id, version: 1, instruction: "Read", inputs: [{ name: "evidence", source: "writer", artifact: "report" }] }),
    node("z", "end")], edges: [edge("s", "writer"), { ...edge("writer", "reader"), schema: "report" }, edge("reader", "z")] });
  const save = (payload, extra = {}) => workflows.save({ project: "one", payload, ...extra });
  const saved = save(handoff());
  assert.equal(workflows.get("one", saved.id, 1).payload.edges[1].schema, "report");
  const plan = workflows.executionPlan("one", saved.payload, saved.id);
  assert.equal(plan.document.edges[1].schema, "report");
  assert.equal(plan.display.edges[1].schema, "report");
  const parent = save({ name: "Parent", nodes: [node("s", "start"), node("child", "subgraph", { workflow: saved.id }), node("z", "end")],
    edges: [edge("s", "child"), edge("child", "z")] });
  const childEdge = workflows.executionPlan("one", parent.payload, parent.id).display.edges.find(({ schema }) => schema === "report");
  assert.match(childEdge.from, /^n-/);
  assert.match(childEdge.to, /^n-/);
  definitions.saveDefinition({ scope: "personal", id: producer.id, version: 1, kind: "harness",
    payload: { ...producerPayload, result: { ...producerPayload.result, path: "new.json" } } });
  assert.equal(workflows.executionPlan("one", handoff()).display.edges[1].schema, "report");
  const badVersion = handoff(); delete badVersion.nodes[1].version;
  assert.throws(() => workflows.executionPlan("one", badVersion), /source must declare this artifact at the harness result path/);
  assert.throws(() => save(badVersion, { id: saved.id, version: 1 }), /harness result path/);
  assert.equal(workflows.get("one", saved.id).version, 1);

  const wrongArtifact = handoff(); wrongArtifact.edges[1].schema = "other";
  assert.throws(() => save(wrongArtifact), /source must declare this artifact/);
  const missingBinding = handoff(); missingBinding.nodes[2].inputs = [];
  assert.throws(() => save(missingBinding), /target must bind this artifact/);
  const wrongInput = handoff(); wrongInput.nodes[2].inputs[0].name = "undeclared";
  assert.throws(() => workflows.saveCanvas({ project: "one", id: saved.id, version: 1, payload: wrongInput }), /declared harness input/);
  const labelOnly = handoff(); labelOnly.nodes[1].definition = consumer.id;
  assert.throws(() => save(labelOnly), /harness result path/);
  const loopGraph = handoff();
  loopGraph.name = "Typed loop handoff";
  Object.assign(loopGraph.nodes[1], { type: "loop", definition: loop.id });
  assert.equal(save(loopGraph).payload.edges[1].schema, "report");
  assert.throws(() => workflows.executionPlan("two", loopGraph), /wrong project or kind/);
  const unsupported = handoff();
  Object.assign(unsupported.nodes[2], { type: "command", definition: undefined, ...check });
  assert.throws(() => save(unsupported), /both endpoints must use a pinned Agent or Loop harness/);

  const untyped = handoff(); delete untyped.edges[1].schema; delete untyped.nodes[1].version;
  const next = save(untyped, { id: saved.id, version: 1 });
  assert.equal(next.payload.nodes[1].version, 2);
  assert.equal(Object.hasOwn(next.payload.edges[1], "schema"), false);
});

test("a V2 database migrates in place and workflows preserve immutable reference versions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-graph-test-"));
  const file = path.join(dir, "engineering.sqlite");
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec(fs.readFileSync(path.join(__dirname, "../server/engineering/schema.sql"), "utf8"));
    db.exec("PRAGMA user_version=1");
    const insert = db.prepare("INSERT INTO project VALUES (?,?,?,?,0)");
    insert.run("one", dir, "Original project", "main");
    insert.run("two", path.join(dir, "other"), "Other project", "main");
    db.exec(`INSERT INTO definition VALUES ('legacy-model', 'two', 'model', 'Legacy model', 1),
      ('legacy-harness', 'two', 'harness', 'Legacy harness', 1);
      INSERT INTO definition_version VALUES ('legacy-model', 1, '{"name":"Legacy model"}'),
      ('legacy-harness', 1, '{"name":"Legacy harness"}');
      INSERT INTO definition_ref VALUES ('legacy-harness', 1, 'legacy-model', 1)`);
    db.close();
    db = openDatabase(file);
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    assert.equal(definitions.project("one").name, "Original project");
    const legacy = definitions.versionOf("legacy-harness", 1);
    assert.equal(legacy.scope, "project");
    assert.equal(legacy.project, "two");
    assert.equal(definitions.dependency(legacy).id, "legacy-model");
    const model = definitions.saveDefinition({ project: "one", kind: "model", payload: { name: "M", provider: "fixture", model: "fake" } });
    const harness = { name: "H", adapter: "claude", model: model.id, role: "dev" };
    const savedHarness = definitions.saveDefinition({ project: "one", kind: "harness", payload: harness });
    const input = { name: "Workflow", nodes: [node("s", "start"), node("w", "agent", {
      definition: savedHarness.id, instruction: "Implement the fixture",
    }), node("z", "end")], edges: [edge("s", "w"), edge("w", "z")] };
    assert.throws(() => workflows.save({ project: "two", payload: input }), /wrong project/);
    const saved = workflows.save({ project: "one", payload: input });
    definitions.saveDefinition({ project: "one", kind: "harness", id: savedHarness.id, version: 1, payload: harness });
    const next = workflows.save({ project: "one", id: saved.id, version: 1, payload: input });
    assert.equal(next.payload.nodes[1].version, 2);
    assert.deepEqual(workflows.harnessUses("one", savedHarness.id).map(({ node, harnessVersion }) =>
      [node, harnessVersion]), [["w", 2]]);
    const loop = definitions.saveDefinition({ project: "one", kind: "loop", payload: {
      name: "Retry", harness: savedHarness.id, attempts: 2, timeoutMs: 1000, budgetCents: 10,
      checks: [check.check],
    } });
    const loopGraph = { ...input, name: "Loop workflow",
      nodes: [node("s", "start"), node("w", "loop", { definition: loop.id, instruction: "Try" }), node("z", "end")] };
    const savedLoop = workflows.save({ project: "one", payload: loopGraph });
    const refs = workflows.harnessUses("one", savedHarness.id);
    assert.equal(refs.length, 2);
    assert.equal(refs.find((ref) => ref.loop)?.loopVersion, 1);
    assert.throws(() => workflows.save({ project: "one", id: saved.id, version: 1, payload: input }), /changed/);
    const upgraded = definitions.saveDefinition({ project: "one", kind: "harness", id: savedHarness.id, version: 2,
      payload: { ...harness, result: { path: "review.json", shape: "array", fields: ["file"] } } });
    const change = { project: "one", node: "w", harness: savedHarness.id, harnessVersion: upgraded.version };
    const direct = workflows.relinkHarness({ ...change, workflow: saved.id, version: 2 });
    assert.equal(direct.workflow.version, 3);
    assert.equal(direct.workflow.payload.nodes[1].version, 3);
    assert.equal(direct.workflow.payload.nodes[1].outputs[0].path, "review.json");
    assert.equal(workflows.get("one", saved.id, 2).payload.nodes[1].version, 2);
    assert.throws(() => workflows.relinkHarness({ ...change, workflow: saved.id, version: 2 }), /changed/);
    const indirect = workflows.relinkHarness({ ...change, workflow: savedLoop.id, version: 1 });
    assert.equal(indirect.loop.version, 2);
    assert.equal(definitions.dependency(indirect.loop).version, 3);
    assert.equal(definitions.dependency(loop).version, 2);
    assert.equal(workflows.get("one", savedLoop.id, 1).payload.nodes[1].version, 1);
    const edited = workflows.saveCanvas({ id: savedLoop.id, project: "one", version: 2, payload: indirect.workflow.payload,
      loops: [{ node: "w", attempts: 5 }] });
    assert.equal(edited.version, 3);
    const adjusted = definitions.versionOf(loop.id, edited.payload.nodes[1].version);
    assert.equal(adjusted.payload.attempts, 5);
    assert.equal(definitions.dependency(adjusted).version, 3);
    assert.equal(definitions.versionOf(loop.id, 2).payload.attempts, 2);
    assert.throws(() => workflows.saveCanvas({ id: savedLoop.id, project: "one", version: 2, payload: edited.payload,
      loops: [{ node: "w", attempts: 6 }] }), /changed/);
    assert.equal(definitions.versionOf(loop.id).version, adjusted.version);
    assert.throws(() => definitions.remove(savedHarness.id), /referenced/);
    db.close();
    db = openDatabase(file);
    const reloaded = workflowCatalog(db, catalog(db));
    assert.equal(reloaded.get("one", saved.id, 1).payload.nodes[1].version, 1);
    assert.equal(reloaded.get("one", saved.id).version, 3);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db?.close();
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("scheduler enables parallel branches and waits for all active join inputs", () => {
  const { graphScheduler } = require("../server/engineering/graph-scheduler");
  const scheduler = graphScheduler(compileGraph(graph()));
  const results = new Map();
  const ready = () => scheduler.advance(results).ready.map((item) => item.id);
  const done = (id, outcome) => results.set(id, { status: "succeeded", ...outcome });
  assert.deepEqual(ready(), ["s"]);
  done("s"); assert.deepEqual(ready(), ["p"]);
  done("p"); assert.deepEqual(ready(), ["a", "b"]);
  done("a", { status: "failed", passed: false });
  assert.deepEqual(ready(), ["b", "c"]);
  const condition = graph().nodes.find(({ id }) => id === "c");
  assert.equal(scheduler.conditionPort(condition, results), "false");
  done("c", { port: "false" });
  assert.deepEqual(ready(), ["b"]);
  done("b"); assert.deepEqual(ready(), ["j"]);
  done("j"); assert.deepEqual(ready(), ["z"]);
  assert.equal(scheduler.outcome(results), null);
  done("z"); assert.equal(scheduler.outcome(results), "succeeded");
});

test("scheduler leaves approval successors pending until a recorded decision", () => {
  const { graphScheduler } = require("../server/engineering/graph-scheduler");
  const plan = compileGraph({ name: "Approval", nodes: [
    node("s", "start"), node("a", "approval", { prompt: "Review" }), node("w", "command", check), node("z", "end"),
  ], edges: [edge("s", "a"), edge("a", "w", "approved"), edge("w", "z")] });
  const scheduler = graphScheduler(plan);
  const results = new Map([["s", { status: "succeeded" }], ["a", { status: "waiting_approval" }]]);
  assert.deepEqual(scheduler.advance(results), { ready: [], skipped: [] });
  results.set("a", { status: "succeeded", port: "rejected" });
  assert.deepEqual(scheduler.advance(results), { ready: [], skipped: ["w", "z"] });
  for (const id of ["w", "z"]) results.set(id, { status: "skipped" });
  assert.equal(scheduler.outcome(results), "failed");
});

test("Subgraph calls are versioned, expand under separate node ids, and reject recursion", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-subgraph-test-"));
  const db = openDatabase(path.join(dir, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", dir, "Project", "main");
    const workflows = workflowCatalog(db, catalog(db));
    const shell = (name, middle) => ({ name, nodes: [node("s", "start"), middle, node("e", "end")],
      edges: [edge("s", middle.id), edge(middle.id, "e")] });
    const child = workflows.save({ project: "one", payload: shell("child", node("validate", "command", check)) });
    const parent = workflows.save({ project: "one", payload: shell("parent", node("child-call", "subgraph", { workflow: child.id })) });
    assert.equal(parent.payload.nodes[1].version, 1);
    workflows.save({ project: "one", id: child.id, version: 1, payload: shell("child", node("new-check", "command", check)) });
    const plan = workflows.executionPlan("one", parent.payload, parent.id);
    const ordered = plan.order.map((id) => plan.document.nodes.find((item) => item.id === id));
    assert.deepEqual(ordered.map(({ type }) => type), ["start", "scope-enter", "command", "scope-exit", "end"]);
    assert.match(ordered[2].label, /validate/);
    assert.equal(ordered[3].id, "child-call");
    assert.throws(() => workflows.save({ project: "one", id: child.id, version: 2,
      payload: shell("child", node("recur", "subgraph", { workflow: parent.id })) }), /Recursive/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("template exchange replaces runtime IDs with project references and rejects embedded credentials", () => {
  const { workflowTemplates } = require("../server/engineering/workflow-templates");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-template-test-"));
  const db = openDatabase(path.join(dir, "engineering.sqlite"));
  try {
    const add = db.prepare("INSERT INTO project VALUES (?,?,?,?,0)");
    add.run("one", dir, "Original", "main");
    add.run("two", path.join(dir, "other"), "Target", "main");
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    const templates = workflowTemplates(definitions, workflows);
    const prepare = (project) => {
      const model = definitions.saveDefinition({ project, kind: "model", payload: { name: "Provider", provider: "fixture", model: "fake" } });
      return definitions.saveDefinition({ project, kind: "harness", payload: { name: "Editor", adapter: "claude", model: model.id, role: "editor" } });
    };
    const first = prepare("one");
    const saved = workflows.save({ project: "one", payload: {
      name: "Portable", nodes: [node("s", "start"), node("a", "agent", { definition: first.id, instruction: "Edit the fixture" }), node("e", "end")],
      edges: [edge("s", "a"), edge("a", "e")],
    } });
    const output = templates.export("one", saved.id, saved.version);
    assert.equal(JSON.stringify(output).includes(first.id), false);
    assert.throws(() => templates.import("two", output), /matching project definition/);
    const second = prepare("two");
    const restored = templates.import("two", output);
    assert.equal(restored.payload.nodes[1].definition, second.id);
    assert.equal(restored.payload.nodes[1].version, 1);
    assert.deepEqual(restored.payload.edges, saved.payload.edges);
    output.payload.nodes[1].instruction = "api_key=fixture-credential";
    assert.throws(() => templates.import("two", output, "another"), /embedded credentials/);
  } finally {
    db.close();
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("scoped harnesses keep distinct identities and can only run in eligible projects", async () => {
  const { nodeExecutor } = require("../server/engineering/workflow-node-executor");
  const { workflowTemplates } = require("../server/engineering/workflow-templates");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-harness-scope-"));
  const db = openDatabase(path.join(dir, "engineering.sqlite"));
  try {
    const add = db.prepare("INSERT INTO project VALUES (?,?,?,?,0)");
    for (const id of ["one", "two", "other"]) add.run(id, path.join(dir, id), id, "main");
    db.exec("INSERT INTO harness_team VALUES ('Engineering'), ('Operations'); " +
      "INSERT INTO project_team VALUES ('one', 'Engineering'), ('two', 'Engineering'), ('other', 'Operations')");
    const catalogStore = catalog(db);
    const workflows = workflowCatalog(db, catalogStore);
    const templates = workflowTemplates(catalogStore, workflows);
    const make = (owner) => {
      const model = catalogStore.saveDefinition({ ...owner, kind: "model", payload: { name: "Default", provider: "fixture", model: "fake" } });
      return catalogStore.saveDefinition({ ...owner, kind: "harness", payload: { name: "Review", adapter: "omp", model: model.id, role: "reviewer" } });
    };
    const personal = make({ scope: "personal" });
    const team = make({ scope: "team", team: "Engineering" });
    const project = make({ project: "one" });
    const ids = (id) => catalogStore.definitions(id).filter(({ kind }) => kind === "harness").map((row) => row.id);
    assert.deepEqual(ids("one"), [project.id, team.id, personal.id]);
    assert.deepEqual(ids("two"), [team.id, personal.id]);
    assert.deepEqual(ids("other"), [personal.id]);
    assert.equal(catalogStore.definitions(null, "personal").length, 2);
    assert.throws(() => catalogStore.saveDefinition({ scope: "team", team: "Operations", kind: "harness", payload: team.payload }), /incompatible scope/);
    assert.throws(() => catalogStore.saveDefinition({ scope: "team", team: "Engineering", kind: "harness",
      id: project.id, version: 1, payload: team.payload }), /immutable/);
    const payload = { name: "Review", nodes: [node("s", "start"),
      node("a", "agent", { definition: team.id, instruction: "Review the fixture" }), node("e", "end")],
      edges: [edge("s", "a"), edge("a", "e")] };
    assert.throws(() => workflows.save({ project: "other", payload }), /wrong project/);
    const first = workflows.save({ project: "one", payload });
    const imported = templates.import("two", templates.export("one", first.id, 1));
    assert.equal(imported.payload.nodes.find(({ id }) => id === "a").definition, team.id);
    const execute = nodeExecutor(catalogStore, { requireAdapter: () => ({ run: async () => ({ costCents: 0 }) }) });
    const outcome = await execute(imported.payload.nodes.find(({ id }) => id === "a"), "two", dir, 10, new AbortController().signal);
    assert.equal(outcome.status, "succeeded");
    assert.equal(outcome.definitions.harness.id, team.id);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
