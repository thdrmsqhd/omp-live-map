"use strict";

const { string, integer, checkCommand } = require("./definitions");
const { problem } = require("./state");

const types = new Set(["start", "end", "agent", "command", "loop", "condition", "parallel", "join", "approval"]);
const ports = {
  end: [], condition: ["true", "false"], approval: ["approved", "rejected"],
};

function bad(message) {
  throw problem(400, message);
}

function array(value, label, max) {
  if (!Array.isArray(value) || value.length > max) bad("Invalid " + label);
  return value;
}

function identifier(value, label) {
  const id = string(value, label, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) bad("Invalid " + label);
  return id;
}

function artifactPath(value) {
  const file = string(value, "artifact path", 512);
  const parts = file.split("/");
  if (parts.some((part) => !part || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) bad("Artifact paths must be portable workspace-relative paths");
  return file;
}

function contract(raw) {
  const inputs = array(raw.inputs ?? [], "node inputs", 16).map((input) => ({
    name: identifier(input?.name, "input name"),
    source: identifier(input?.source, "input source"),
    artifact: identifier(input?.artifact, "source artifact name"),
  }));
  const outputs = array(raw.outputs ?? [], "node outputs", 16).map((output) => ({
    name: identifier(output?.name, "artifact name"),
    path: artifactPath(output?.path),
  }));
  if (new Set(inputs.map((input) => input.name)).size !== inputs.length ||
      new Set(outputs.map((output) => output.name)).size !== outputs.length ||
      new Set(outputs.map((output) => output.path.toLowerCase())).size !== outputs.length) bad("Duplicate node input or output");
  return { inputs, outputs };
}

function settings(type, raw) {
  if (type === "agent" || type === "loop") return {
    definition: string(raw.definition, "node definition"),
    ...(raw.version === undefined ? {} : { version: integer(raw.version, "node definition version", 1, Number.MAX_SAFE_INTEGER) }),
    instruction: string(raw.instruction, "node instruction", 12000),
  };
  if (type === "command") return { check: checkCommand(raw.check) };
  if (type === "condition") {
    const source = identifier(raw.source, "condition source");
    const field = raw.field;
    if (field === "passed" && typeof raw.equals === "boolean") return { source, field, equals: raw.equals };
    if (field === "status" && ["succeeded", "failed", "skipped"].includes(raw.equals)) return { source, field, equals: raw.equals };
    bad("Use a structured status or check-result condition");
  }
  if (type === "approval") return { prompt: string(raw.prompt, "approval prompt", 2000) };
  return {};
}

function node(raw) {
  if (!raw || !types.has(raw.type)) bad("Unknown graph node type");
  return {
    id: identifier(raw.id, "node id"), type: raw.type, label: string(raw.label, "node label"),
    x: integer(raw.x ?? 0, "node x", 0, 10000), y: integer(raw.y ?? 0, "node y", 0, 10000),
    ...contract(raw), ...settings(raw.type, raw),
  };
}

function compileGraph(payload) {
  const name = string(payload?.name, "workflow name");
  const nodes = array(payload.nodes, "graph nodes", 100).map(node);
  const edges = array(payload.edges, "graph connections", 300).map((edge) => ({
    from: identifier(edge?.from, "edge source"), to: identifier(edge?.to, "edge target"),
    port: identifier(edge?.port ?? "next", "output port"),
  }));
  const byId = new Map(nodes.map((item) => [item.id, { ...item, incoming: [], outgoing: [] }]));
  const starts = nodes.filter((item) => item.type === "start");
  const ends = nodes.filter((item) => item.type === "end");
  if (byId.size !== nodes.length) bad("Duplicate graph node ID");
  if (starts.length !== 1 || ends.length !== 1) bad("A graph needs exactly one Start and one End");
  for (const edge of edges) {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to || from === to || !(ports[from.type] ?? ["next"]).includes(edge.port)) bad("Invalid graph connection or output port");
    if (from.outgoing.some(({ to, port }) => to === edge.to && port === edge.port)) bad("Duplicate graph connection");
    from.outgoing.push(edge);
    to.incoming.push(edge);
  }
  for (const item of byId.values()) {
    const { type, incoming, outgoing } = item;
    const minInputs = type === "start" ? 0 : type === "join" ? 2 : 1;
    const maxInputs = ["end", "join"].includes(type) ? Infinity : minInputs;
    if (incoming.length < minInputs || incoming.length > maxInputs) bad("Invalid incoming connections for " + item.id);
    if (type === "parallel" && (outgoing.length < 2 || new Set(outgoing.map((edge) => edge.to)).size !== outgoing.length)) {
      bad("Parallel requires two or more distinct branches");
    }
    if (type === "join" && new Set(incoming.map((edge) => edge.from)).size < 2) bad("Join requires distinct predecessors");
    if (type === "parallel") continue;
    for (const port of ports[type] ?? ["next"]) {
      const count = outgoing.filter((edge) => edge.port === port).length;
      if (count !== 1 && !(type === "approval" && port === "rejected" && count === 0)) bad("Missing or duplicate output " + item.id + "." + port);
    }
  }
  const order = [];
  const ready = [starts[0].id];
  const remaining = new Map([...byId].map(([id, item]) => [id, item.incoming.length]));
  const ancestors = new Map();
  while (ready.length) {
    const id = ready.shift();
    const item = byId.get(id);
    order.push(id);
    const prior = new Set();
    for (const { from } of item.incoming) {
      prior.add(from);
      for (const ancestor of ancestors.get(from)) prior.add(ancestor);
    }
    ancestors.set(id, prior);
    for (const { to } of item.outgoing) {
      const count = remaining.get(to) - 1;
      remaining.set(to, count);
      if (!count) ready.push(to);
    }
    ready.sort();
  }
  if (order.length !== nodes.length) bad("A graph cannot contain cycles or unreachable nodes");
  const producers = new Set(["agent", "loop", "command"]);
  for (const item of nodes) {
    const prior = ancestors.get(item.id);
    if (item.outputs.length && !producers.has(item.type)) bad("Only execution nodes declare artifacts");
    if (item.source && (!prior.has(item.source) || (item.field === "passed" && !["command", "loop"].includes(byId.get(item.source).type)))) {
      bad("Condition source must be a compatible predecessor");
    }
    for (const input of item.inputs) {
      if (!prior.has(input.source) || !byId.get(input.source).outputs.some(({ name }) => name === input.artifact)) {
        bad("Input must reference a predecessor artifact");
      }
    }
  }
  return { document: { name, nodes, edges }, order };
}

module.exports = { compileGraph, artifactPath };
