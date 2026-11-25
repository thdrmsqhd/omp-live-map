"use strict";
function makeDelta(previous,data){const old=new Map((previous?.sessions||[]).map(s=>[s.key,JSON.stringify(s)]));const next=new Set(data.sessions.map(s=>s.key));const {sessions,...meta}=data;return {meta,upsert:sessions.filter(s=>old.get(s.key)!==JSON.stringify(s)),remove:[...old.keys()].filter(k=>!next.has(k)),order:sessions.map(s=>s.key)};}
function applyDelta(previous,d){const map=new Map((previous?.sessions||[]).map(s=>[s.key,s]));for(const k of d.remove)map.delete(k);for(const s of d.upsert)map.set(s.key,s);return {...d.meta,sessions:d.order.map(k=>map.get(k)).filter(Boolean)};}
module.exports={makeDelta,applyDelta};

function encodeGraph(data, revision) {
  const { sessions, generatedAt, ...fields } = data;
  const entries = new Map();
  for (const session of sessions) {
    const { nodes, ...rest } = session;
    const encoded = new Map(nodes.map((node) => [node.id, JSON.stringify(node)]));
    entries.set(session.key, { fields: JSON.stringify(rest), nodes: encoded });
  }
  return { revision, generatedAt, fields: JSON.stringify(fields), entries };
}

function graphChanges(previous, next) {
  const changes = [];
  const removals = [...previous.entries.keys()].filter((key) => !next.entries.has(key));
  const order = [...next.entries.keys()];
  const reordered = !sameOrder([...previous.entries.keys()], order);
  const metadataChanged = previous.fields !== next.fields;
  for (const [key, session] of next.entries) {
    const old = previous.entries.get(key);
    const nodeOrder = [...session.nodes.keys()];
    const oldOrder = old ? [...old.nodes.keys()] : [];
    const upserts = nodeOrder.filter((id) => old?.nodes.get(id) !== session.nodes.get(id));
    const fields = old?.fields !== session.fields;
    const nodesReordered = !sameOrder(oldOrder, nodeOrder);
    if (fields || nodesReordered || upserts.length) changes.push({ key, fields, upserts, nodeOrder: nodesReordered ? nodeOrder : undefined });
  }
  return { changes, removals, order, reordered, metadataChanged, changed: changes.length > 0 || reordered || metadataChanged };
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function encodedSession(session) {
  return `${session.fields.slice(0, -1)},"nodes":[${[...session.nodes.values()].join(",")}]}`;
}

function snapshotFrame(graph, version) {
  const revision = version === 2 ? `,"graphRevision":${graph.revision}` : "";
  const sessions = [...graph.entries.values()].map(encodedSession).join(",");
  return `data: ${metadata(graph)}${revision},"sessions":[${sessions}]}\n\n`;
}

function metadata(graph) {
  const prefix = graph.fields === "{}" ? "{" : `${graph.fields.slice(0, -1)},`;
  return `${prefix}"generatedAt":${JSON.stringify(graph.generatedAt ?? null)}`;
}

function deltaFrame(previous, next, delta, version) {
  const remove = JSON.stringify(delta.removals);
  if (version !== 2) {
    const sessions = delta.changes.map(({ key }) => encodedSession(next.entries.get(key))).join(",");
    return `data: {"graphDelta":{"meta":${metadata(next)}},"order":${JSON.stringify(delta.order)},"remove":${remove},"upsert":[${sessions}]}}\n\n`;
  }
  const changes = delta.changes.map(({ key, fields, upserts, nodeOrder }) => {
    const session = next.entries.get(key);
    const nodes = upserts.map((id) => session.nodes.get(id)).join(",");
    const props = fields ? `,"fields":${session.fields}` : "";
    const reorder = nodeOrder ? `,"order":${JSON.stringify(nodeOrder)}` : "";
    return `{"key":${JSON.stringify(key)},"upsert":[${nodes}]${props}${reorder}}`;
  }).join(",");
  const fullMetadata = delta.metadataChanged ? `,"meta":${next.fields}` : "";
  const order = delta.reordered ? `,"order":${JSON.stringify(delta.order)}` : "";
  return `data: {"graphPatch":{"baseRevision":${previous.revision},"revision":${next.revision},"generatedAt":${JSON.stringify(next.generatedAt ?? null)}${fullMetadata}${order},"remove":${remove},"sessions":[${changes}]}}\n\n`;
}

Object.assign(module.exports, { encodeGraph, graphChanges, snapshotFrame, deltaFrame });
