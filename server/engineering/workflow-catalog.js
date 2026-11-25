"use strict";

const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { event } = require("./catalog");
const { compileGraph } = require("./graph-definition");
const { expandSubgraphs } = require("./workflow-subgraphs");
const { string, integer } = require("./definitions");
const { problem } = require("./state");

function workflowCatalog(db, catalog) {
  function get(project, id, version) {
    const row = db.prepare(`SELECT w.id, w.project, v.version, v.payload FROM workflow w JOIN workflow_version v
      ON w.id=v.workflow WHERE w.project=? AND w.id=? AND v.version=COALESCE(?,w.version)`).get(project, id, version ?? null);
    if (!row) throw problem(404, "Workflow version not found");
    const payload = JSON.parse(row.payload);
    return { ...row, name: payload.name, payload };
  }

  function plan(project, payload) {
    catalog.project(project);
    const result = compileGraph(payload);
    for (const item of result.document.nodes) {
      if (item.type === "subgraph") item.version = get(project, item.workflow, item.version).version;
      if (!item.definition) continue;
      const target = catalog.versionOf(item.definition, item.version);
      if (!catalog.availableTo(target, project) || target.kind !== (item.type === "agent" ? "harness" : "loop")) {
        throw problem(400, "Workflow node references a definition of the wrong project or kind");
      }
      item.version = target.version;
    }
    return result;
  }

  function executionPlan(project, payload, id) {
    const { document } = plan(project, payload);
    return compileGraph(expandSubgraphs(document, (workflow, version) => get(project, workflow, version).payload, id), { expanded: true });
  }

  function writeWorkflow(body) {
    const project = string(body.project, "project");
    if (catalog.project(project).archived) throw problem(409, "Project is archived");
    const { document } = plan(project, body.payload);
    const previous = body.id ? get(project, string(body.id, "workflow")) : null;
    if (previous && integer(body.version, "workflow version", 1, Number.MAX_SAFE_INTEGER) !== previous.version) {
      throw problem(409, "Workflow changed. Reload it before saving.");
    }
    const id = previous?.id ?? randomUUID();
    const version = (previous?.version ?? 0) + 1;
    executionPlan(project, document, id);
    const duplicate = db.prepare("SELECT id FROM workflow WHERE project=? AND name=?").get(project, document.name);
    if (duplicate && duplicate.id !== id) throw problem(409, "Workflow name is already in use");
    if (previous) db.prepare("UPDATE workflow SET version=?, name=? WHERE id=?").run(version, document.name, id);
    else db.prepare("INSERT INTO workflow VALUES (?,?,?,?)").run(id, project, document.name, version);
    db.prepare("INSERT INTO workflow_version VALUES (?,?,?)").run(id, version, JSON.stringify(document));
    const ref = db.prepare("INSERT INTO workflow_definition VALUES (?,?,?,?,?)");
    const subref = db.prepare("INSERT INTO workflow_subgraph VALUES (?,?,?,?,?)");
    for (const item of document.nodes) {
      if (item.definition) ref.run(id, version, item.id, item.definition, item.version);
      if (item.type === "subgraph") subref.run(id, version, item.id, item.workflow, item.version);
    }
    event(db, "workflow.saved", { id, version, project });
    return get(project, id, version);
  }


  function harnessUses(project, id) {
    const record = catalog.versionOf(id);
    if (!catalog.availableTo(record, project) || record.kind !== "harness") throw problem(404, "Harness not found");
    return db.prepare(`SELECT w.id AS workflow, w.name, w.version, x.node,
      COALESCE(r.target_version,x.target_version) AS harnessVersion,
      CASE WHEN r.source IS NOT NULL THEN x.target END AS loop,
      CASE WHEN r.source IS NOT NULL THEN d.name END AS loopName,
      CASE WHEN r.source IS NOT NULL THEN x.target_version END AS loopVersion
      FROM workflow w JOIN workflow_definition x ON x.workflow=w.id AND x.version=w.version
      JOIN definition d ON d.id=x.target
      LEFT JOIN definition_ref r ON d.kind='loop' AND r.source=x.target AND r.version=x.target_version
      WHERE w.project=? AND ((d.kind='harness' AND x.target=?) OR r.target=?)
      ORDER BY w.name,x.node`).all(project, id, id);
  }

  function relinkHarness(body) {
    const project = string(body.project, "project");
    return transaction(db, () => {
      const workflow = get(project, string(body.workflow, "workflow"));
      if (workflow.version !== integer(body.version, "workflow version", 1, Number.MAX_SAFE_INTEGER)) {
        throw problem(409, "Workflow changed. Reload it before applying a harness.");
      }
      const node = workflow.payload.nodes.find(({ id }) => id === string(body.node, "node"));
      if (!node?.definition || !["agent", "loop"].includes(node.type)) throw problem(404, "Harness workflow node not found");
      const pinned = catalog.versionOf(node.definition, node.version);
      const previous = node.type === "loop" ? catalog.dependency(pinned) : pinned;
      const next = catalog.versionOf(string(body.harness, "harness"),
        integer(body.harnessVersion, "harness version", 1, Number.MAX_SAFE_INTEGER));
      if (!previous || !catalog.availableTo(next, project) || next.kind !== "harness" || next.id !== previous.id) {
        throw problem(400, "The selected profile does not match the workflow's harness");
      }
      if (next.version === previous.version) return { workflow, loop: null };
      const missing = (next.payload.assets?.inputs ?? []).filter((name) => !node.inputs.some((input) => input.name === name));
      if (missing.length) throw problem(409, "Connect the required workflow inputs first: " + missing.join(", "));

      const result = next.payload.result;
      if (result && !node.outputs.some((output) => output.path === result.path)) {
        const previousOutput = node.outputs.find((output) => output.path === previous.payload.result?.path);
        if (previousOutput) previousOutput.path = result.path;
        else {
          let name = "harness_result";
          while (node.outputs.some((output) => output.name === name)) name += "_";
          node.outputs.push({ name, path: result.path });
        }
      }
      let loop = null;
      if (node.type === "loop") {
        const latest = catalog.versionOf(pinned.id);
        loop = catalog.writeDefinition({ project, kind: "loop", id: pinned.id, version: latest.version,
          payload: { ...pinned.payload, name: latest.name }, referenceVersion: next.version });
        node.version = loop.version;
      } else node.version = next.version;
      return { workflow: writeWorkflow({ project, id: workflow.id, version: workflow.version, payload: workflow.payload }), loop };
    });
  }

  function saveCanvas(body) {
    return transaction(db, () => {
      const project = string(body.project, "project");
      const current = get(project, string(body.id, "workflow"));
      if (body.version !== current.version) throw problem(409, "Workflow changed. Reload it before saving.");
      const document = plan(project, body.payload).document;
      const overrides = body.loops ?? [];
      if (!Array.isArray(overrides) || overrides.length > document.nodes.length ||
          new Set(overrides.map((entry) => entry?.node)).size !== overrides.length) throw problem(400, "Invalid Loop overrides");

      const replacements = new Map();
      for (const override of overrides) {
        const node = document.nodes.find(({ id, type }) => id === override?.node && type === "loop");
        if (!node) throw problem(400, "Select a valid Loop node");
        const previous = catalog.versionOf(node.definition, node.version);
        const attempts = integer(override.attempts, "attempt count", 1, 8);
        if (previous.payload.attempts === attempts) continue;
        const key = JSON.stringify([previous.id, previous.version, attempts]);
        if (!replacements.has(key)) {
          const latest = catalog.versionOf(previous.id);
          const harness = catalog.dependency(previous);
          const replacement = catalog.writeDefinition({ project, id: latest.id, version: latest.version, kind: "loop",
            payload: { ...previous.payload, name: latest.name, attempts }, referenceVersion: harness.version });
          replacements.set(key, replacement.version);
        }
        node.version = replacements.get(key);
      }
      return writeWorkflow({ ...body, payload: document });
    });
  }

  function ensurePreset(project, payload) {
    for (const row of db.prepare("SELECT id FROM workflow WHERE project=? AND name=?").all(project, payload.name)) {
      const existing = get(project, row.id, 1);
      if (JSON.stringify(existing.payload) === JSON.stringify(plan(project, payload).document)) return existing;
      throw problem(409, "A workflow already uses this template name");
    }
    return writeWorkflow({ project, payload });
  }

  return { get, plan, executionPlan, ensurePreset, saveCanvas, save: (body) => transaction(db, () => writeWorkflow(body)), harnessUses, relinkHarness, list(project) {
    catalog.project(project);
    return db.prepare("SELECT id,name,version FROM workflow WHERE project=? ORDER BY name,id").all(project);
  } };
}

module.exports = { workflowCatalog };
