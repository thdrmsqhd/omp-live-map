// 스냅샷: 파일 상태들을 세션/노드 그래프로 묶고 messages 예산을 적용한다.
"use strict";

const path = require("path");
const { HOME, ROOT, SESSIONS, HOURS, ACTIVE_MS, USD_KRW } = require("./config");
const { allStates, stateOf } = require("./tail");
const lineage = require("./lineage");
const { resFor, histOf } = require("./proc");
const { ctxWindowOf } = require("./models");
const { profileOf } = require("./profiles");
const { sumHourly } = require("./turns");
const { attachImages } = require("./images");
const { capMessages } = require("./msg-cap");
const { HARNESSES } = require("./harness");

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
  const card = lineage.cardOf(st.file);
  return {
    id: card || st.file,
    file: st.file, // 지금 실제 기록 파일(카드 id 와 다를 수 있다)
    harness: st.harness || "omp", // 이 세션을 만든 실행기. UI 는 이 값과 기능 플래그로 버튼을 가른다.
    name: st.name,
    kind: st.kind,
    agent: st.agent || "", // Claude 서브에이전트 agentType / omp 는 finishSession 이 채운다.
    agentModel: st.agentModel || "", // 그 프로필 정의의 첫 모델
    agentThinking: "", // 그 프로필 정의의 thinking-level
    parent: lineage.cardOf(st.parent) || st.parent, // 세션 안에 없는 부모는 finishSession에서 정리한다.
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
    status: st.statusOverride || statusOf(st, now, last), // Claude 서브는 meta.finished 가 우선
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

// 서브에이전트는 마지막 assistant 응답이 툴 호출 없이 끝났으면 done. session_exit 직후(2초)에 끝난 기록만 done, 그 뒤 이어 쓰였으면 90초 이내 live.
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
    const pst = stateOf(lineage.resolve(n.parent));
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
    const st = stateOf(n.file || n.id);
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
    // 비우기 전 기록(그 세션의 서브 기록 포함)은 맵에 따로 그리지 않는다. 같은 카드가 새 파일을 보여 준다.
    if (lineage.isHidden(st.file) || lineage.isHidden(st.mainFile)) continue;
    const node = nodeOf(st, now, last);
    // 비운 카드도 이름(첫 요청·제목)은 처음 기록 그대로 남긴다.
    if (node.id !== st.file) {
      const origin = stateOf(node.id);
      if (origin) {
        if (!node.title) node.title = origin.title;
        if (!node.firstUser) node.firstUser = origin.firstUser;
      }
    }
    const key = lineage.sessionKeyOf(st.mainFile) || st.sessionKey;
    let s = sessions.get(key);
    if (!s) {
      s = { key, folder: path.basename(path.dirname(st.file)).replace(/--/g, ""), nodes: [], lastTs: 0 };
      sessions.set(key, s);
    }
    s.nodes.push(node);
    s.lastTs = Math.max(s.lastTs, last);
  }
  // Claude Code 세션: 메인·서브·비우기 직후 빈 카드를 같은 모양으로 묶는다(claude| 접두사 키).
  require("./harness/claude-merge").mergeInto(sessions, cutoff, now, nodeOf);
  const list = [...sessions.values()].sort((a, b) => b.lastTs - a.lastTs);
  for (const s of list) finishSession(s);
  capMessages(list);
  attachImages(list);
  return {
    generatedAt: now,
    fx: { usdKrw: USD_KRW },
    harness: HARNESSES, // 하네스별 표시 이름·기능 플래그. UI 는 노드의 harness 로 여기를 찾는다.
    env: { home: HOME, localCwd: process.env.OMP_MAP_CWD || path.dirname(ROOT) },
    sessions: list,
  };
}

module.exports = { snapshot, statusOf };
