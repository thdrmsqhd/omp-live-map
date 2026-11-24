"use strict";

const { createHash } = require("node:crypto");
const { problem } = require("./state");

function expandSubgraphs(document, load, currentId) {
  let count = 0;
  const scopedId = (namespace, id) => "n-" + createHash("sha256").update(namespace + ":" + id).digest("hex").slice(0, 40);

  function expand(graph, ancestry, boundary) {
    if (ancestry.length > 8) throw problem(400, "Subgraphs may be nested at most eight levels");
    const map = new Map(graph.nodes.map((item) => [item.id, !boundary ? item.id :
      item.type === "end" ? boundary.id : scopedId(boundary.id, item.id)]));
    const target = new Map();
    const output = new Map();
    const nodes = [], edges = [];
    for (const original of graph.nodes) {
      const item = { ...original, id: map.get(original.id) };
      if (boundary) item.label = (boundary.label + " › " + item.label).slice(0, 240);
      if (boundary && item.type === "start") item.type = "scope-enter";
      if (boundary && item.type === "end") item.type = "scope-exit";
      if (item.source) item.source = map.get(item.source);
      item.inputs = item.inputs.map((input) => ({ ...input, source: map.get(input.source) }));
      if (item.type === "subgraph") {
        if (ancestry.includes(item.workflow)) throw problem(400, "Recursive workflow reference");
        const child = expand(load(item.workflow, item.version), [...ancestry, item.workflow], item);
        nodes.push(...child.nodes);
        edges.push(...child.edges);
        target.set(original.id, child.entry);
        output.set(original.id, item.id);
      } else {
        if (++count > 100) throw problem(400, "Expanded workflow exceeds 100 nodes");
        nodes.push(item);
        target.set(original.id, item.id);
        output.set(original.id, item.id);
      }
    }
    edges.push(...graph.edges.map(({ from, to, port }) => ({ from: output.get(from), to: target.get(to), port })));
    return { nodes, edges, entry: target.get(graph.nodes.find((item) => item.type === "start").id) };
  }

  const { nodes, edges } = expand(document, currentId ? [currentId] : []);
  return { name: document.name, nodes, edges };
}

module.exports = { expandSubgraphs };
