// Claude 스냅샷 병합: 메인·서브·비우기 직후 빈 카드를 omp 와 같은 세션/노드 모양으로 sessions 에 넣는다.
// 계보(lineage)로 비운 카드의 id·키를 유지하고, 숨긴 이전 파일은 건너뛴다. 상태는 갖지 않는다.
"use strict";

const path = require("path");
const lineage = require("../lineage");
const claude = require("./claude");
const pending = require("./claude-pending");

// 비우기 직후처럼 아직 파일이 없는 카드의 빈 상태.
function pendingStates() {
  return pending.list().map((p) => ({ ...claude.newState(p.file), id: p.card, cwd: p.cwd, title: p.title,
    lastTs: p.at, startedAt: p.at, sessionKey: p.key || "claude|" + path.basename(p.file, ".jsonl") }));
}

function mergeInto(sessions, cutoff, now, nodeOf) {
  for (const st of [...claude.states(), ...pendingStates()]) {
    const last = st.lastTs || st.startedAt;
    if (!last || last < cutoff) continue;
    if (lineage.isHidden(st.file) || (st.mainFile && lineage.isHidden(st.mainFile))) continue;
    const key = (st.mainFile && lineage.sessionKeyOf(st.mainFile)) || lineage.sessionKeyOf(st.file) || st.sessionKey;
    let s = sessions.get(key);
    if (!s) {
      s = { key, folder: path.basename(path.dirname(st.file)), nodes: [], lastTs: 0, harness: "claude" };
      sessions.set(key, s);
    }
    const node = nodeOf(st, now, last);
    s.nodes.push(node); s.lastTs = Math.max(s.lastTs, last);
  }
}

module.exports = { mergeInto };
