"use strict";

const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { event } = require("./catalog");
const { compileGraph } = require("./graph-definition");
const { expandSubgraphs } = require("./workflow-subgraphs");
const { string, integer } = require("./definitions");
const { problem } = require("./state");
const profiles = require("../harness/session-profiles");
const { listPresets } = require("./workflow-presets");

// 템플릿으로 빠른 실행할 때 자동으로 생기는 사본(workflow-launch.js makePreset: "<템플릿 이름> · <해시 12자>")이면
// 템플릿 이름을 돌려준다. 목록에서 사용자가 저장한 Workflow 와 구분해 보여 주려고 쓴다.
function generatedTemplate(name) {
  const match = /^(.+) · ([0-9a-f]{12})$/.exec(name);
  return match && listPresets().some((preset) => preset.name === match[1]) ? match[1] : null;
}

function workflowCatalog(db, catalog) {
  function get(project, id, version) {
    const row = db.prepare(`SELECT w.id, w.project, v.version, v.payload FROM workflow w JOIN workflow_version v
      ON w.id=v.workflow WHERE w.project=? AND w.id=? AND v.version=COALESCE(?,w.version)`).get(project, id, version ?? null);
    if (!row) throw problem(404, "Workflow version not found");
    const payload = JSON.parse(row.payload);
    return { ...row, name: payload.name, payload };
  }

  function resolveProfile(node) {
    const profile = profiles.pinned(node.profileId, node.profileVersion);
    if (!profile) throw problem(400, "프로필 버전을 찾을 수 없습니다: " + node.label);
    if (!profile.model) throw problem(400, "Workflow에서 사용할 모델을 프로필에 지정하세요: " + node.label);
    return profile;
  }

  function plan(project, payload) {
    catalog.project(project);
    const result = compileGraph(payload);
    for (const item of result.document.nodes) {
      if (item.type === "profile") resolveProfile(item);
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
    const expanded = compileGraph(expandSubgraphs(document, (workflow, version) => get(project, workflow, version).payload, id), { expanded: true });
    for (const node of expanded.document.nodes) {
      const linked = expanded.configuration.get(node.id);
      if (linked) node.sessionProfile = resolveProfile(linked);
    }
    return expanded;
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
        loop = writeLoopOverride(project, pinned, {}, next.version);
        node.definition = loop.id;
        node.version = loop.version;
      } else node.version = next.version;
      return { workflow: writeWorkflow({ project, id: workflow.id, version: workflow.version, payload: workflow.payload }), loop };
    });
  }

  function writeLoopOverride(project, pinned, changes, referenceVersion) {
    const latest = catalog.versionOf(pinned.id);
    const local = latest.scope === "project";
    const name = local ? latest.name : latest.name.slice(0, 216) + " · " + randomUUID().slice(0, 8);
    return catalog.writeDefinition({ project, kind: "loop", ...(local ? { id: latest.id, version: latest.version } : {}),
      payload: { ...pinned.payload, ...changes, name }, referenceVersion });
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
          const harness = catalog.dependency(previous);
          replacements.set(key, writeLoopOverride(project, previous, { attempts }, harness.version));
        }
        const replacement = replacements.get(key);
        node.definition = replacement.id;
        node.version = replacement.version;
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
    return db.prepare("SELECT id,name,version FROM workflow WHERE project=? ORDER BY name,id").all(project).map((row) => {
      const template = generatedTemplate(row.name);
      return template ? { ...row, generated: true, template } : row;
    });
  } };
}

module.exports = { workflowCatalog, generatedTemplate };
