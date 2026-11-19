// SSE: 구독 클라이언트 소유, chat 이벤트 전송, 변경 감지 후 스냅샷 방송.
"use strict";

const { snapshot } = require("./snapshot");
const lineage = require("./lineage");

const clients = new Set();
let lastSig = "";

// 화면은 카드 id 로만 노드를 찾는다. 실제 파일로 온 이벤트는 계보를 거쳐 카드 id 로 바꿔 보낸다.
function remap(payload) {
  if (!payload || !payload.node) return payload;
  const card = lineage.cardOf(payload.node);
  return card && card !== payload.node ? { ...payload, node: card } : payload;
}

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function pushChat(payload) {
  const frame = `data: ${JSON.stringify({ chat: remap(payload) })}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch {} }
}

function pushLive(payload) {
  const frame = `data: ${JSON.stringify({ live: remap(payload) })}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch {} }
}

function pushAsk(payload) {
  const frame = `data: ${JSON.stringify({ ask: remap(payload) })}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch {} }
}

// 세션의 자원 요약: [프로세스 수, round(cpu/10), round(mb/100)].
// 노드마다 겹치지 않는 몫(server/attrib.js)을 가지므로 세션 값은 노드 합이다.
function resSig(s) {
  let proc = 0, cpu = 0, mb = 0;
  for (const n of s.nodes) {
    if (!n.res) continue;
    proc += n.res.proc || 0;
    cpu += n.res.cpu || 0;
    mb += n.res.mb || 0;
  }
  return [proc, Math.round(cpu / 10), Math.round(mb / 100)];
}

function broadcast() {
  const data = snapshot();
  const sig = JSON.stringify(data.sessions.map((s) => [
    s.key, s.lastTs, s.totals.tokens, s.live, ...resSig(s),
    s.jobs.map((j) => [j.id, j.done, (j.tail || []).length, (j.tail || [])[(j.tail || []).length - 1] || ""]),
    s.nodes.map((n) => [n.status, (n.active || []).map((a) => [a.id, a.name, a.ts])]),
  ]));
  if (sig === lastSig) return;
  lastSig = sig;
  const frame = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

module.exports = { addClient, removeClient, pushChat, pushLive, pushAsk, broadcast };
