// 메시지 예산: 스냅샷 응답 전체의 messages 를 MSG_BUDGET 바이트 이하로 자른다.
// 전 노드를 통틀어 최근 메시지부터 남기므로 오래된 대화는 잘려도 지금 상황은 보인다.
"use strict";

const { MSG_BUDGET } = require("./config");

function capMessages(list) {
  const all = [];
  for (const s of list) {
    for (const n of s.nodes) {
      if (!n.messages) continue;
      n.messages.forEach((m, i) => all.push({ n, i, ts: m.ts || 0, size: Buffer.byteLength(JSON.stringify(m)) + 1 }));
    }
  }
  let total = all.reduce((acc, x) => acc + x.size, 0);
  if (total <= MSG_BUDGET) return;
  all.sort((a, b) => b.ts - a.ts || b.i - a.i);
  const keep = new Map(); // node -> Set(index)
  total = 0;
  for (const x of all) {
    if (total + x.size > MSG_BUDGET) continue;
    total += x.size;
    if (!keep.has(x.n)) keep.set(x.n, new Set());
    keep.get(x.n).add(x.i);
  }
  for (const s of list) {
    for (const n of s.nodes) {
      if (!n.messages) continue;
      const k = keep.get(n);
      n.messages = k ? n.messages.filter((_, i) => k.has(i)) : [];
    }
  }
}

module.exports = { capMessages };
