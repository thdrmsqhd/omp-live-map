"use strict";

const { randomUUID } = require("node:crypto");
const { transaction } = require("../infrastructure/sqlite");
const { event } = require("./catalog");
const { compileGraph } = require("./graph-definition");
const { expandSubgraphs } = require("./workflow-subgraphs");
const { string, integer } = require("./definitions");
const { resultContract } = require("./harness-result");
const { problem } = require("./state");
const { listPresets } = require("./workflow-presets");

// 템플릿으로 빠른 실행할 때 자동으로 생기는 사본(workflow-launch.js makePreset: "<템플릿 이름> · <해시 12자>")이면
// 템플릿 이름을 돌려준다. 목록에서 사용자가 저장한 Workflow 와 구분해 보여 주려고 쓴다.
function generatedTemplate(name) {
  const match = /^(.+) · ([0-9a-f]{12})$/.exec(name);
  if (match?.[1].startsWith("Loop 실행 · ")) return "Loop 실행";   // 예전 Loop 실행 탭이 만든 사본(이력 표시용)
  return match && listPresets().some((preset) => preset.name === match[1]) ? match[1] : null;
}

function workflowCatalog(db, catalog) {
  // Workflow 는 정의처럼 개인·팀·프로젝트 범위를 갖는다(v14). project 는 '이 프로젝트에서 쓸 수 있는가'를 묻는 문맥이다.
  function get(project, id, version) {
    const row = db.prepare(`SELECT w.id, w.project, w.team, w.scope, v.version, v.payload FROM workflow w JOIN workflow_version v
      ON w.id=v.workflow WHERE w.id=? AND v.version=COALESCE(?,w.version)`).get(id, version ?? null);
    if (!row || !catalog.availableTo(row, project)) throw problem(404, "Workflow version not found");
    const payload = JSON.parse(row.payload);
    return { ...row, name: payload.name, payload };
  }
  const ownerOfRow = (row) => ({ scope: row.scope, project: row.project ?? null, team: row.team ?? null });
  const sameOwner = (a, b) => a.scope === b.scope && (a.project ?? null) === (b.project ?? null) && (a.team ?? null) === (b.team ?? null);
  // 프로젝트에서 보이는 Workflow: 그 프로젝트 것 + 개인 + 같은 팀.
  const VISIBLE = "(w.scope='personal' OR (w.scope='project' AND w.project=?) OR (w.scope='team' AND w.team IS ?))";

  // A schema ID names the producer artifact validated by its pinned harness result contract.
  // The receiver must bind that exact artifact to a name its pinned harness actually consumes.
  function validateHandoffs(project, document, definitions) {
    const typed = document.edges.filter(({ schema }) => schema !== undefined);
    if (!typed.length) return;
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const harnesses = new Map();
    function harness(id) {
      if (harnesses.has(id)) return harnesses.get(id);
      const target = definitions.get(id);
      const pinned = target?.kind === "loop" ? catalog.dependency(target) : target;
      const supported = pinned?.kind === "harness" && catalog.availableTo(pinned, project) ? pinned.payload : null;
      harnesses.set(id, supported);
      return supported;
    }
    for (const { from, to, schema } of typed) {
      const source = harness(from), target = harness(to);
      const fail = (reason) => { throw problem(400, `Handoff ${from} → ${to} (${schema}): ${reason}`); };
      if (!source || !target) fail("both endpoints must use a pinned Agent or Loop harness available to this project");
      const output = nodes.get(from).outputs.find(({ name }) => name === schema);
      const result = resultContract(source.result);
      if (!result || !output || result.path !== output.path) fail("source must declare this artifact at the harness result path");
      const inputs = target.assets?.inputs;
      if (!Array.isArray(inputs) || inputs.length > 5 || !nodes.get(to).inputs.some((input) =>
        input.source === from && input.artifact === schema && inputs.includes(input.name))) {
        fail("target must bind this artifact to a declared harness input");
      }
    }
  }

  // owner 를 주면(팀·개인 Workflow 저장) 참조하는 정의·하위 Workflow 도 그 범위에서 쓸 수 있어야 한다.
  // 팀 Workflow 가 한 프로젝트의 하네스를 참조하면 같은 팀의 다른 프로젝트에서 풀리지 않기 때문이다.
  function plan(project, payload, owner = null) {
    catalog.project(project);
    const result = compileGraph(payload);
    const definitions = new Map();
    for (const item of result.document.nodes) {
      if (item.type === "subgraph") {
        const sub = get(project, item.workflow, item.version);
        if (owner && owner.scope !== "project" && !catalog.availableToOwner(sub, owner)) {
          throw problem(400, "Workflow node references a workflow outside this workflow's scope");
        }
        item.version = sub.version;
      }
      if (!item.definition) continue;
      const target = catalog.versionOf(item.definition, item.version);
      if (!catalog.availableTo(target, project) || target.kind !== (item.type === "agent" ? "harness" : "loop") ||
          (owner && owner.scope !== "project" && !catalog.availableToOwner(target, owner))) {
        throw problem(400, "Workflow node references a definition of the wrong project or kind");
      }
      item.version = target.version;
      definitions.set(item.id, target);
    }
    validateHandoffs(project, result.document, definitions);
    return result;
  }

  function executionPlan(project, payload, id) {
    const { document } = plan(project, payload);
    return compileGraph(expandSubgraphs(document, (workflow, version) => get(project, workflow, version).payload, id), { expanded: true });
  }

  function writeWorkflow(body) {
    const project = string(body.project, "project");
    if (catalog.project(project).archived) throw problem(409, "Project is archived");
    const previous = body.id ? get(project, string(body.id, "workflow")) : null;
    // 범위는 처음 저장할 때 정하고 바꾸지 않는다. 팀 범위는 이 프로젝트의 팀으로 정한다.
    const owner = previous ? ownerOfRow(previous)
      : catalog.definitionOwner(body.scope ?? "project", project, body.scope === "team" ? catalog.project(project).team : null);
    if (previous && body.scope !== undefined && body.scope !== previous.scope) throw problem(400, "Workflow scope is immutable");
    const { document } = plan(project, body.payload, owner);
    if (previous && integer(body.version, "workflow version", 1, Number.MAX_SAFE_INTEGER) !== previous.version) {
      throw problem(409, "Workflow changed. Reload it before saving.");
    }
    const id = previous?.id ?? randomUUID();
    const version = (previous?.version ?? 0) + 1;
    executionPlan(project, document, id);
    const duplicate = db.prepare("SELECT id FROM workflow WHERE scope=? AND project IS ? AND team IS ? AND name=?")
      .get(owner.scope, owner.project, owner.team, document.name);
    if (duplicate && duplicate.id !== id) throw problem(409, "Workflow name is already in use");
    if (previous) db.prepare("UPDATE workflow SET version=?, name=? WHERE id=?").run(version, document.name, id);
    else db.prepare("INSERT INTO workflow(id,project,team,scope,name,version) VALUES (?,?,?,?,?,?)")
      .run(id, owner.project, owner.team, owner.scope, document.name, version);
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
      WHERE ${VISIBLE} AND ((d.kind='harness' AND x.target=?) OR r.target=?)
      ORDER BY w.name,x.node`).all(project, catalog.project(project).team ?? null, id, id);
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
        throw problem(400, "The selected harness does not match the workflow's harness");
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
        loop = writeLoopOverride(project, pinned, {}, next.version, ownerOfRow(workflow));
        node.definition = loop.id;
        node.version = loop.version;
      } else node.version = next.version;
      return { workflow: writeWorkflow({ project, id: workflow.id, version: workflow.version, payload: workflow.payload }), loop };
    });
  }

  // Loop 설정을 바꾼 사본은 Workflow 와 같은 범위에 둔다(팀 Workflow 의 사본은 팀 범위).
  function writeLoopOverride(project, pinned, changes, referenceVersion, owner = { scope: "project", project, team: null }) {
    const latest = catalog.versionOf(pinned.id);
    const local = sameOwner(ownerOfRow(latest), owner);
    const name = local ? latest.name : latest.name.slice(0, 216) + " · " + randomUUID().slice(0, 8);
    return catalog.writeDefinition({ scope: owner.scope, project: owner.project ?? undefined, team: owner.team ?? undefined,
      kind: "loop", ...(local ? { id: latest.id, version: latest.version } : {}),
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
          replacements.set(key, writeLoopOverride(project, previous, { attempts }, harness.version, ownerOfRow(current)));
        }
        const replacement = replacements.get(key);
        node.definition = replacement.id;
        node.version = replacement.version;
      }
      return writeWorkflow({ ...body, payload: document });
    });
  }

  function ensurePreset(project, payload) {
    for (const row of db.prepare("SELECT id FROM workflow WHERE scope='project' AND project=? AND name=?").all(project, payload.name)) {
      const existing = get(project, row.id, 1);
      if (JSON.stringify(existing.payload) === JSON.stringify(plan(project, payload).document)) return existing;
      throw problem(409, "A workflow already uses this template name");
    }
    return writeWorkflow({ project, payload });
  }

  return { get, plan, executionPlan, ensurePreset, saveCanvas, save: (body) => transaction(db, () => writeWorkflow(body)), harnessUses, relinkHarness, list(project) {
    const team = catalog.project(project).team ?? null;
    return db.prepare(`SELECT w.id,w.name,w.version,w.scope,w.team FROM workflow w WHERE ${VISIBLE}
      ORDER BY CASE w.scope WHEN 'project' THEN 1 WHEN 'team' THEN 2 ELSE 3 END,w.name,w.id`).all(project, team).map((row) => {
      const template = generatedTemplate(row.name);
      return template ? { ...row, generated: true, template } : row;
    });
  } };
}

module.exports = { workflowCatalog, generatedTemplate };
