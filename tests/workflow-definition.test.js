"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../server/engineering/database");
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
    db.close();
    db = openDatabase(file);
    const definitions = catalog(db), workflows = workflowCatalog(db, definitions);
    assert.equal(definitions.project("one").name, "Original project");
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
    workflows.save({ project: "one", payload: loopGraph });
    const refs = workflows.harnessUses("one", savedHarness.id);
    assert.equal(refs.length, 2);
    assert.equal(refs.find((ref) => ref.loop)?.loopVersion, 1);
    assert.throws(() => workflows.save({ project: "one", id: saved.id, version: 1, payload: input }), /changed/);
    assert.throws(() => definitions.remove(savedHarness.id), /referenced/);
    db.close();
    db = openDatabase(file);
    const reloaded = workflowCatalog(db, catalog(db));
    assert.equal(reloaded.get("one", saved.id, 1).payload.nodes[1].version, 1);
    assert.equal(reloaded.get("one", saved.id).version, 2);
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
