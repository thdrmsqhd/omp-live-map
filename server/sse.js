// SSE: 구독 클라이언트 소유, chat 이벤트 전송, 변경 감지 후 스냅샷 방송.
"use strict";

const { snapshot } = require("./snapshot");
const lineage = require("./lineage");

const clients = new Set();
const {writeFrame}=require("./sse-writer");
let sentBytes=0,sentFrames=0,slowClients=0;
function send(res,frame,options){if(!writeFrame(res,frame,undefined,options)){clients.delete(res);slowClients++;return false;}sentBytes+=Buffer.byteLength(frame);sentFrames++;return true;}
function metrics(){return {clients:clients.size,sentBytes,sentFrames,slowClients};}
const journal=require("./event-journal").createJournal();
const path=require("node:path");const activity=require("./activity-store").createActivityStore(process.env.OMP_MAP_STATE||path.join(require("./config").ROOT,"data"));
const {randomUUID}=require("node:crypto");const turns=new Map();
function publish(payload){const frame=journal.append(payload);for(const res of clients)send(res,frame);}
function replay(res,id){const frames=journal.replay(id);if(!frames)return false;for(const frame of frames)if(!send(res,frame))break;return true;}
let lastGraph = null;
let revision = 0;
const bases = new WeakMap();
const { encodeGraph, graphChanges, snapshotFrame, deltaFrame } = require("./graph-delta");

// 화면은 카드 id 로만 노드를 찾는다. 실제 파일로 온 이벤트는 계보를 거쳐 카드 id 로 바꿔 보낸다.
function remap(payload) {
  if (!payload || !payload.node) return payload;
  const card = lineage.cardOf(payload.node);
  return card && card !== payload.node ? { ...payload, node: card } : payload;
}

function addClient(res, version = 1) {
  clients.add(res);
  bases.set(res, { version, revision: 0 });
}

function removeClient(res) {
  clients.delete(res);
}

function pushChat(payload){const p=remap(payload);if(p.kind==="req"){turns.set(p.node,randomUUID());if(turns.size>512)turns.delete(turns.keys().next().value);}const turnId=turns.get(p.node);publish({chat:{...p,turnId,ts:Date.now()}});if(p.kind==="done")turns.delete(p.node);}
function pushLive(payload){const ev=remap(payload);activity.record(ev);publish({live:ev});}
function pushAsk(payload){publish({ask:remap(payload)});}
function pushQueue(node,queue){publish({queue:remap({node,...queue})});}
function broadcast() {
  if (!clients.size) { lastGraph = null; return; }
  const next = encodeGraph(snapshot(), revision + 1);
  const delta = lastGraph && graphChanges(lastGraph, next);
  if (!delta || delta.changed) revision++;
  const current = delta && !delta.changed ? lastGraph : next;
  const frames = new Map();
  for (const res of clients) {
    const base = bases.get(res);
    if (base.revision === current.revision) continue;
    const patch = delta?.changed && base.revision === lastGraph.revision;
    const key = `${base.version}:${patch}`;
    if (!frames.has(key)) frames.set(key, patch
      ? deltaFrame(lastGraph, current, delta, base.version)
      : snapshotFrame(current, base.version));
    if (send(res, frames.get(key), { allowLarge: true })) base.revision = current.revision;
  }
  lastGraph = current;
}

module.exports = { addClient, removeClient, pushChat, pushLive, pushAsk, pushQueue, replay, broadcast, activityHistory:activity.read,flushActivity:activity.flush,metrics };
