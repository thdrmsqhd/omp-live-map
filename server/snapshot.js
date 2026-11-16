// 스냅샷: 파일 상태들을 세션/노드 그래프로 묶고 messages 예산을 적용한다.
"use strict";

const path = require("path");
const { HOME, ROOT, SESSIONS, HOURS, ACTIVE_MS, MSG_BUDGET, USD_KRW } = require("./config");
const { allStates, stateOf } = require("./tail");
const { resFor, histOf } = require("./proc");
const { ctxWindowOf } = require("./models");
const { profileOf } = require("./profiles");
const { sumHourly } = require("./turns");
const { attachImages } = require("./images");

function tokPerSec(st) {
  if (!st.durationSum) return 0;
  return (st.usage.output / st.durationSum) * 1000;
}

function recentTokPerSec(st) {
  const r = st.recent.slice(-5).filter((x) => x.dur > 0);
  if (!r.length) return 0;
  const out = r.reduce((s, x) => s + x.out, 0);
  const dur = r.reduce((s, x) => s + x.dur, 0);
  return dur ? (out / dur) * 1000 : 0;
}

function nodeOf(st, now, last) {
  return {
    id: st.file,
    name: st.name,
    kind: st.kind,
    agent: "", // 서브에이전트가 쓴 프로필 이름. finishSession 이 부모 task 툴 호출에서 채운다.
    agentModel: "", // 그 프로필 정의의 첫 모델
    agentThinking: "", // 그 프로필 정의의 thinking-level
    parent: st.parent, // 세션 안에 없는 부모는 finishSession에서 정리한다.
    title: st.title,
    firstUser: st.firstUser,
    model: st.model,
    provider: st.provider,
    cwd: st.cwd,
    startedAt: st.startedAt,
    lastTs: last,
    requests: st.requests,
    turns: st.turns,
    tokens: st.usage,
    cost: st.cost,
    auxCost: st.auxCost,
    auxRequests: st.auxRequests,
    ctxWindow: ctxWindowOf(st.provider, st.model),
    tokens1h: sumHourly(st, now),
    tokPerSec: Number(tokPerSec(st).toFixed(1)),
    liveTokPerSec: Number(recentTokPerSec(st).toFixed(1)),
    avgTtft: st.ttftN ? Math.round(st.ttftSum / st.ttftN) : 0,
    ttftN: st.ttftN,
    errors: st.errors,
    status: statusOf(st, now, last),
    active: st.active && st.active.size ? [...st.active.values()] : [], // 지금 도는 툴(툴 결과가 아직 없는 것)
    tools: [...st.tools.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count),
    commands: st.commands,
    files: st.files,
    series: st.recent,
    ctx: st.ctx,
    messages: st.messages.map((m) => (m._imgs ? { ...m } : m)),
    res: { ...resFor(st.file), hist: histOf(st.file) },
    lastUser: st.lastUser,
    lastAssistant: st.lastAssistant,
  };
}

// 서브에이전트는 마지막 assistant 응답이 툴 호출 없이 끝났으면 done(idle·parked로 남아도 일하지 않는다).
// 그 밖에는 session_exit 직후(2초 이내)에 끝난 기록만 done. 그 뒤 이어 쓰였으면(resume) 90초 이내 live, 아니면 idle.
function statusOf(st, now, last) {
  if (st.kind === "sub" && st.turnOver) return "done";
  if (st.endedAt && last - st.endedAt < 2000) return "done";
  return now - last < ACTIVE_MS ? "live" : "idle";
}

function syntheticRoot(id, sub) {
  return {
    id, name: "main", kind: "main", parent: null, synthetic: true,
    title: "", firstUser: "", model: sub.model, provider: sub.provider, cwd: sub.cwd,
    startedAt: sub.startedAt, lastTs: sub.lastTs, requests: 0, turns: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0, auxCost: 0, auxRequests: 0, ctxWindow: 0,
    tokens1h: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, requests: 0 },
    tokPerSec: 0, liveTokPerSec: 0, avgTtft: 0, errors: 0,
    status: sub.status === "live" ? "live" : "done", tools: [], commands: [], files: [],
    res: { cpu: 0, mb: 0, proc: 0, procs: [], all: [], owner: 0, main: true, hist: [] },
  };
}

function finishSession(s) {
  // 메인 .jsonl이 없거나(삭제·빈 파일) 기간 밖이면 세션 메인 경로로 root를 만들어 트리를 잇는다.
  let root = s.nodes.find((n) => n.kind === "main");
  if (!root) {
    root = syntheticRoot(path.join(SESSIONS, ...s.key.split("|")), s.nodes[0]);
    s.nodes.unshift(root);
  }
  // 부모 기록이 없거나 기간 밖인 서브에이전트는 세션 root에 붙인다.
  const ids = new Set(s.nodes.map((n) => n.id));
  for (const n of s.nodes) if (n !== root && (!n.parent || !ids.has(n.parent))) n.parent = root.id;
  s.folder = (s.nodes.find((n) => n.cwd) || {}).cwd || s.key;
  const main = s.nodes.find((n) => n.kind === "main");
  s.title = (main && (main.title || main.firstUser)) || String(s.folder).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "(untitled)";
  s.totals = s.nodes.reduce(
    (acc, n) => {
      acc.tokens += n.tokens.total;
      acc.output += n.tokens.output;
      acc.cost += n.cost;
      acc.requests += n.requests;
      acc.agents += 1;
      return acc;
    },
    { tokens: 0, output: 0, cost: 0, requests: 0, agents: 0 }
  );
  s.live = s.nodes.some((n) => n.status === "live");
  // 서브 기록 파일명(<Name>)은 부모 task 툴 호출의 tasks[].name 과 같다. 부모 상태에서 프로필 이름을 찾는다.
  for (const n of s.nodes) {
    if (n.kind !== "sub") continue;
    const pst = stateOf(n.parent);
    const map = pst && pst.taskProfiles;
    if (!map || !map.has(n.name)) continue;
    n.agent = map.get(n.name);
    const prof = profileOf(n.agent);
    if (prof) {
      n.agentModel = prof.models[0] || "";
      n.agentThinking = prof.thinking;
    }
  }
  s.jobs = [];
  for (const n of s.nodes) {
    const st = stateOf(n.id);
    if (!st) continue;
    for (const j of st.jobs) s.jobs.push({ ...j, file: n.id, session: s.key, sessionTitle: s.title, node: n.name, cwd: n.cwd });
  }
  s.jobs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function snapshot() {
  const now = Date.now();
  const cutoff = now - HOURS * 3_600_000;
  const sessions = new Map();
  for (const st of allStates()) {
    if (!st.lastTs && !st.startedAt) continue;
    const last = st.lastTs || st.startedAt;
    if (last < cutoff) continue;
    const node = nodeOf(st, now, last);
    let s = sessions.get(st.sessionKey);
    if (!s) {
      s = { key: st.sessionKey, folder: path.basename(path.dirname(st.file)).replace(/--/g, ""), nodes: [], lastTs: 0 };
      sessions.set(st.sessionKey, s);
    }
    s.nodes.push(node);
    s.lastTs = Math.max(s.lastTs, last);
  }
  const list = [...sessions.values()].sort((a, b) => b.lastTs - a.lastTs);
  for (const s of list) finishSession(s);
  capMessages(list);
  attachImages(list);
  return {
    generatedAt: now,
    fx: { usdKrw: USD_KRW },
    env: { home: HOME, localCwd: process.env.OMP_MAP_CWD || path.dirname(ROOT) },
    sessions: list,
  };
}

// 응답 전체의 messages를 MSG_BUDGET 바이트 이하로 자른다(전 노드 통틀어 최근 메시지 우선).
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
    if (total + x.size > MSG_BUDGET) break;
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

module.exports = { snapshot, statusOf };
