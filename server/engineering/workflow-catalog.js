"use strict";

const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { event } = require("./catalog");
const { compileGraph } = require("./graph-definition");
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
      if (!item.definition) continue;
      const target = catalog.versionOf(item.definition, item.version);
      if (target.project !== project || target.kind !== (item.type === "agent" ? "harness" : "loop")) {
        throw problem(400, "Workflow node references a definition of the wrong project or kind");
      }
      item.version = target.version;
    }
    return result;
  }

  function save(body) {
    const project = string(body.project, "project");
    return transaction(db, () => {
      if (catalog.project(project).archived) throw problem(409, "Project is archived");
      const { document } = plan(project, body.payload);
      const previous = body.id ? get(project, string(body.id, "workflow")) : null;
      if (previous && integer(body.version, "workflow version", 1, Number.MAX_SAFE_INTEGER) !== previous.version) {
        throw problem(409, "Workflow changed. Reload it before saving.");
      }
      const id = previous?.id ?? randomUUID();
      const version = (previous?.version ?? 0) + 1;
      const duplicate = db.prepare("SELECT id FROM workflow WHERE project=? AND name=?").get(project, document.name);
      if (duplicate && duplicate.id !== id) throw problem(409, "Workflow name is already in use");
      if (previous) db.prepare("UPDATE workflow SET version=?, name=? WHERE id=?").run(version, document.name, id);
      else db.prepare("INSERT INTO workflow VALUES (?,?,?,?)").run(id, project, document.name, version);
      db.prepare("INSERT INTO workflow_version VALUES (?,?,?)").run(id, version, JSON.stringify(document));
      const ref = db.prepare("INSERT INTO workflow_definition VALUES (?,?,?,?,?)");
      for (const item of document.nodes) {
        if (item.definition) ref.run(id, version, item.id, item.definition, item.version);
      }
      event(db, "workflow.saved", { id, version, project });
      return get(project, id, version);
    });
  }

  return { get, plan, save, list(project) {
    catalog.project(project);
    return db.prepare("SELECT id,name,version FROM workflow WHERE project=? ORDER BY name,id").all(project);
  } };
}

module.exports = { workflowCatalog };
