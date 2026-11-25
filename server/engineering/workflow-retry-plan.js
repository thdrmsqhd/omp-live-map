"use strict";

const { problem } = require("./state");

function descendants(graph, start) {
  const edges = new Map(graph.nodes.map(({ id }) => [id, []]));
  for (const edge of graph.edges) edges.get(edge.from).push(edge.to);
  const visited = new Set(), pending = [...(edges.get(start) ?? [])];
  while (pending.length) {
    const child = pending.pop();
    if (visited.has(child)) continue;
    visited.add(child);
    pending.push(...edges.get(child));
  }
  return visited;
}

function retryPlan(graph, states, failed, restart = failed, mode = "retry") {
  const original = graph.nodes.find(({ id }) => id === failed);
  const node = graph.nodes.find(({ id }) => id === restart);
  const known = states.find(({ node }) => node === failed);
  if (known?.status !== "failed" || known.outcome?.interrupted || known.outcome?.passed !== false) {
    throw problem(409, "Only a failed node with a known result can be retried");
  }
  if (!original || !node || !["retry", "verify", "rework"].includes(mode)) throw problem(400, "Invalid workflow retry");
  const children = descendants(graph, restart);
  if (mode === "verify" && (original.type !== "loop" || failed !== restart)) {
    throw problem(400, "Verification-only applies to a failed Loop");
  }
  if (mode === "rework" && (!["agent", "loop"].includes(node.type) ||
      (restart !== failed && (!children.has(failed) || states.find(({ node }) => node === restart)?.status !== "succeeded")))) {
    throw problem(409, "Select the failed agent or a completed upstream implementation");
  }
  if (mode !== "rework" && failed !== restart) throw problem(400, "This retry must start from the failed node");
  const types = new Map(graph.nodes.map(({ id, type }) => [id, type]));
  if (states.some((item) => children.has(item.node) && item.node !== failed && item.status !== "skipped" &&
      !["condition", "join", "scope-enter", "scope-exit"].includes(types.get(item.node)))) {
    throw problem(409, "A downstream node already executed; start a new workflow run");
  }
  return children;
}

function retryOptions(graph, states) {
  const options = {};
  for (const { node, status } of states) {
    if (status !== "failed") continue;
    try { retryPlan(graph, states, node); } catch { continue; }
    const source = graph.nodes.find(({ id }) => id === node);
    options[node] = { verify: source.type === "loop", rework: graph.nodes.flatMap((candidate) => {
      try { retryPlan(graph, states, node, candidate.id, "rework"); return [{ id: candidate.id, label: candidate.label }]; }
      catch { return []; }
    }) };
  }
  return options;
}

module.exports = { retryPlan, retryOptions };
