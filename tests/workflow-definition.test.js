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
