// SSE: 구독 클라이언트 소유, chat 이벤트 전송, 변경 감지 후 스냅샷 방송.
"use strict";

const { snapshot } = require("./snapshot");

const clients = new Set();
let lastSig = "";

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function pushChat(payload) {
  const frame = `data: ${JSON.stringify({ chat: payload })}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch {} }
}

function pushLive(payload) {
  const frame = `data: ${JSON.stringify({ live: payload })}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch {} }
}

// 세션의 자원 요약: [프로세스 수, round(cpu/10), round(mb/100)].
// 한 세션의 노드들은 같은 프로세스 트리를 보므로 합치지 않고 가장 큰 값 하나만 쓴다(작은 흔들림으로 방송하지 않게).
function resSig(s) {
  let proc = 0, cpu = 0, mb = 0;
  for (const n of s.nodes) {
    if (!n.res) continue;
    proc = Math.max(proc, n.res.proc || 0);
    cpu = Math.max(cpu, n.res.cpu || 0);
    mb = Math.max(mb, n.res.mb || 0);
  }
  return [proc, Math.round(cpu / 10), Math.round(mb / 100)];
}

function broadcast() {
  const data = snapshot();
  const sig = JSON.stringify(data.sessions.map((s) => [
    s.key, s.lastTs, s.totals.tokens, s.live, ...resSig(s),
    s.jobs.map((j) => [j.id, j.done, (j.tail || []).length, (j.tail || [])[(j.tail || []).length - 1] || ""]),
    s.nodes.map((n) => (n.active || []).map((a) => [a.id, a.name, a.ts])),
  ]));
  if (sig === lastSig) return;
  lastSig = sig;
  const frame = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

module.exports = { addClient, removeClient, pushChat, pushLive, broadcast };
