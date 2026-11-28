// 활동 요약 잇기: 한 세션의 노드(main·sub·중첩 sub)마다 활동 요약을 만들고, 부모가 서브에이전트에게 준 지시(목표)·
// 받은 결과(결과 한 줄·실패)·자식 id 목록을 붙인다. 순수 함수다(snapshot.js 가 finishSession 에서 부른다).
"use strict";

const { summary } = require("./activity");

const FAILED = /fail|error|abort|cancel|timeout/i;

// nodes: [{ id, parent, kind, name, status, title }], stateOf(node) → { act, toolUseId, harness } | null
function treeActivity(nodes, stateOf) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const n of nodes) if (n.parent && byId.has(n.parent)) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.id);
  }
  for (const n of nodes) {
    const st = stateOf(n);
    const parent = n.parent ? stateOf(byId.get(n.parent) || {}) : null;
    const keys = [st?.toolUseId, n.name].filter(Boolean).map(String);
    const pick = (map) => (map ? keys.map((key) => map.get(key)).find(Boolean) : undefined);
    const result = pick(parent?.act?.results);
    let goal = pick(parent?.act?.spawned) || "";
    // Claude 서브에이전트는 meta.description 이 제목이다(부모 기록이 기간 밖이어도 남는다).
    if (!goal && n.kind === "sub" && st?.harness === "claude" && n.title) goal = n.title;
    n.act = summary(st?.act, n.status, {
      goal, result: result?.text, failed: Boolean(result && FAILED.test(result.status || "")), children: children.get(n.id) || [], turnOver: Boolean(st?.turnOver),
    });
  }
  return nodes;
}

module.exports = { treeActivity };
