"use strict";

const settled = new Set(["succeeded", "failed", "skipped"]);

function edgeState(edge, parent, child, results) {
  const outcome = results.get(parent.id);
  if (!outcome || !settled.has(outcome.status)) return "waiting";
  if (outcome.status === "skipped") return "inactive";
  if (outcome.status === "failed") {
    return child.type === "condition" && child.source === parent.id ? "active" : "inactive";
  }
  if (parent.type === "condition" || parent.type === "approval") {
    return outcome.port === edge.port ? "active" : "inactive";
  }
  return "active";
}

function conditionPort(node, results) {
  const source = results.get(node.source);
  return source?.[node.field] === node.equals ? "true" : "false";
}

function graphScheduler(plan) {
  const nodes = new Map(plan.document.nodes.map((node) => [node.id, node]));
  const incoming = new Map(plan.order.map((id) => [id, []]));
  const outgoing = new Map(plan.order.map((id) => [id, []]));
  for (const edge of plan.document.edges) {
    incoming.get(edge.to).push(edge);
    outgoing.get(edge.from).push(edge);
  }

  return {
    advance(results) {
      const update = new Map(results);
      const ready = [], skipped = [];
      for (const id of plan.order) {
        if (results.has(id)) continue;
        const item = nodes.get(id);
        const paths = incoming.get(id).map((edge) => edgeState(edge, nodes.get(edge.from), item, update));
        if (paths.includes("waiting")) continue;
        if (item.type === "start" || paths.includes("active")) ready.push(item);
        else {
          skipped.push(id);
          update.set(id, { status: "skipped" });
        }
      }
      return { ready, skipped };
    },
    conditionPort,
    outcome(results) {
      if (plan.order.some((id) => !settled.has(results.get(id)?.status))) return null;
      for (const id of plan.order) {
        if (results.get(id).status !== "failed") continue;
        const handled = outgoing.get(id).some((edge) => {
          const child = nodes.get(edge.to);
          return child.type === "condition" && child.source === id && results.get(child.id)?.status === "succeeded";
        });
        if (!handled) return "failed";
      }
      const end = [...nodes.values()].find(({ type }) => type === "end");
      return results.get(end.id).status === "succeeded" ? "succeeded" : "failed";
    },
  };
}

module.exports = { graphScheduler };
