"use strict";

const { string, integer } = require("./definitions");
const { problem, maskSecrets } = require("./state");

const format = "omp-live-map/workflow-template";
const templateVersion = 1;

function checkText(payload) {
  const pending = [payload];
  while (pending.length) {
    const value = pending.pop();
    // Credentials live outside definitions. Reject common secret material embedded in free-text fields.
    if (typeof value === "string" && (/-----BEGIN [^-]*PRIVATE KEY-----/.test(value) || maskSecrets(value) !== value)) {
      throw problem(400, "Remove embedded credentials before exchanging a workflow template");
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) pending.push(item);
    }
  }
}

function lookupName(records, name, kind, scope) {
  const match = records.find((row) => row.name === name && (!kind || row.kind === kind) &&
    (!kind || (row.scope ?? "project") === (scope ?? "project")));
  if (!match) throw problem(409, "Create a matching project definition before importing: " + name);
  return match.id;
}

function workflowTemplates(catalog, workflows) {
  return {
    export(project, id, version) {
      const saved = workflows.get(project, id, version);
      const nodes = saved.payload.nodes.map((node) => {
        if (node.type === "subgraph") {
          const { workflow, version, ...base } = node;
          const target = workflows.get(project, workflow, version);
          return { ...base, reference: { name: target.name, version } };
        }
        if (!node.definition) return node;
        const { definition, version, ...base } = node;
        const target = catalog.versionOf(definition, version);
        return { ...base, reference: { name: target.name, version,
          ...(target.scope !== "project" ? { scope: target.scope } : {}) } };
      });
      const payload = { ...saved.payload, nodes };
      checkText(payload);
      return { format, version: templateVersion, payload };
    },
    import(project, template, name) {
      if (template?.format !== format || template.version !== templateVersion || !Array.isArray(template.payload?.nodes)) {
        throw problem(400, "Unsupported workflow template");
      }
      if (template.payload.nodes.length > 100) throw problem(400, "Workflow template contains too many nodes");
      checkText(template.payload);
      const definitions = catalog.definitions(project);
      const graph = workflows.list(project);
      const nodes = template.payload.nodes.map((node) => {
        if (node?.type === "subgraph") return { ...node,
          workflow: lookupName(graph, string(node.reference?.name, "workflow name")),
          version: integer(node.reference?.version, "referenced version", 1, Number.MAX_SAFE_INTEGER) };
        if (!["agent", "loop"].includes(node?.type)) return node;
        return { ...node, definition: lookupName(definitions, string(node.reference?.name, "definition name"),
          node.type === "agent" ? "harness" : "loop", node.reference?.scope),
        version: integer(node.reference?.version, "referenced version", 1, Number.MAX_SAFE_INTEGER) };
      });
      return workflows.save({ project, payload: { ...template.payload, name: name || template.payload.name, nodes } });
    },
  };
}

module.exports = { workflowTemplates };
