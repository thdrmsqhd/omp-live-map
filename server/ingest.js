// 기록 파싱: 파일 상태 생성, 부모 경로, JSONL 한 줄을 파일 상태에 반영.
"use strict";

const path = require("path");
const { SESSIONS } = require("./config");
const { recordUser, recordAssistant, noteHourly } = require("./turns");
const { toolStart, toolResult, noteText } = require("./jobs");

function newFileState(file) {
  const rel = path.relative(SESSIONS, file).split(path.sep);
  const base = path.basename(file, ".jsonl");
  const depth = rel.length; // 2 = session, 3 = subagent, 4 = nested subagent
  // 메인(<folder>/<session>.jsonl)과 서브에이전트(<folder>/<session>/...)가 같은 키를 갖도록 .jsonl을 붙인다.
  const sessionKey = rel[0] + "|" + (depth === 2 ? rel[1] || "" : rel[1] + ".jsonl");
  return {
    file,
    rel: rel.join("/"),
    depth,
    sessionKey,
    mainFile: depth === 2 ? file : path.join(SESSIONS, rel[0], rel[1] + ".jsonl"), // 세션 메인 기록 경로
    name: depth === 2 ? "main" : base,
    kind: depth === 2 ? "main" : "sub",
    parent: null,
    title: "",
    model: "",
    provider: "",
    cwd: "",
    startedAt: 0,
    lastTs: 0,
    endedAt: 0,
    turnOver: false, // 마지막 assistant 응답이 툴 호출 없이 끝났고 그 뒤 user 입력이 없음
    requests: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    auxCost: 0, // model_usage(보조 모델) 비용. cost에도 포함된다.
    auxRequests: 0,
    hourly: [], // 최근 1시간 assistant 턴 사용량 {ts, input, output, cacheRead, cacheWrite, total, cost}
    durationSum: 0,
    ttftSum: 0,
    ttftN: 0,
    recent: [], // last assistant turns {ts, out, dur}
    tools: new Map(), // name -> {count, lastTs, intent}
    commands: [], // recent bash commands
    files: [], // recent file paths touched
    errors: 0,
    toolCmds: new Map(),
    ctx: null,
    messages: [],
    lastUser: "",
    lastAssistant: "",
    jobs: [], // 백그라운드 잡 {id, cmd, ts, endedAt, done, status, toolCallId, tail}
    taskProfiles: new Map(), // task 툴로 띄운 서브 이름 -> 프로필 이름(생략 시 "task")
    active: new Map(), // 도는 툴 toolCallId -> {id, name, args, ts}
    liveq: [], // 아직 방송하지 않은 live 이벤트(server/active.js 가 비운다)
    offset: 0,
    pending: "",
    firstUser: "",
    turns: 0,
  };
}

function parentOf(file, depth) {
  // <session>/<Agent>.jsonl -> <session>.jsonl ; <session>/<Agent>/<Sub>.jsonl -> <session>/<Agent>.jsonl
  return depth >= 3 ? path.dirname(file) + ".jsonl" : null;
}

const PATH_KEYS = ["path", "file_path", "filePath", "file"];

// 툴 인자는 객체일 수도 JSON 문자열일 수도 있다.
function toolArgs(a) {
  if (typeof a === "string") {
    try {
      return JSON.parse(a) || {};
    } catch {
      return {};
    }
  }
  return a && typeof a === "object" ? a : {};
}

// task 툴의 tasks[] 에서 서브 이름 -> 프로필 이름을 적어 둔다(agent 생략은 "task").
// 서브 기록 파일명(<Name>.jsonl)이 tasks[].name 과 같아 자식 노드에 프로필로 붙는다.
function noteTasks(st, a) {
  const tasks = Array.isArray(a.tasks) ? a.tasks : [];
  if (!st.taskProfiles) st.taskProfiles = new Map();
  for (const t of tasks) {
    if (!t || !t.name) continue;
    const agent = typeof t.agent === "string" && t.agent ? t.agent : "task";
    st.taskProfiles.set(String(t.name), agent);
  }
}

function notePath(st, value) {
  if (typeof value !== "string" || !value) return;
  if (value.length > 400 || value.includes("\n")) return;
  st.files = [{ p: value, ts: st.lastTs }, ...st.files.filter((f) => f.p !== value)].slice(0, 12);
}

function onUser(st, m, ts) {
  const text = typeof m.content === "string" ? m.content
    : Array.isArray(m.content) ? m.content.map((c) => c.text || "").join(" ") : "";
  if (!st.firstUser && text) st.firstUser = text.replace(/\s+/g, " ").slice(0, 120);
  if (text) {
    st.lastUser = text.replace(/\s+/g, " ").slice(0, 300);
    recordUser(st, text, ts);
  }
  noteText(st, text, ts);
}

function onAssistant(st, m, ts) {
  st.turns += 1;
  st.requests += 1;
  if (m.model) st.model = m.model;
  if (m.provider) st.provider = m.provider;
  const u = m.usage;
  if (u) {
    st.usage.input += u.input || 0;
    st.usage.output += u.output || 0;
    st.usage.cacheRead += u.cacheRead || 0;
    st.usage.cacheWrite += u.cacheWrite || 0;
    st.usage.total += u.totalTokens || 0;
    st.cost += (u.cost && u.cost.total) || 0;
  }
  noteHourly(st, u, ts);
  if (m.duration) {
    st.durationSum += m.duration;
    st.recent.push({ ts: ts || 0, out: (u && u.output) || 0, dur: m.duration });
    if (st.recent.length > 30) st.recent.shift();
  }
  if (m.ttft) {
    st.ttftSum += m.ttft;
    st.ttftN += 1;
  }
  if (m.stopReason === "error") st.errors += 1;
  if (m.contextSnapshot) st.ctx = m.contextSnapshot;
  const blocks = Array.isArray(m.content) ? m.content : [];
  const said = blocks.filter((c) => c.type === "text").map((c) => c.text).join(" ");
  const tools = [...new Set(blocks.filter((c) => c.type === "toolCall" && c.name).map((c) => c.name))];
  recordAssistant(st, said, tools, ts);
  for (const block of blocks) {
    if (block.type !== "toolCall") continue;
    const a = toolArgs(block.arguments);
    for (const k of PATH_KEYS) notePath(st, a[k]);
    if (block.name === "task") noteTasks(st, a);
    if (block.name === "bash" && typeof a.command === "string") {
      st.commands = [{ cmd: a.command.slice(0, 140), ts: ts || 0 }, ...st.commands].slice(0, 8);
      if (block.id) st.toolCmds.set(block.id, a.command.slice(0, 300));
    }
  }
}

function onToolResult(st, e, m, ts) {
  if (e.errorMessage) st.errors += 1;
  toolResult(st, e, m, ts);
}

function ingest(st, raw) {
  let e;
  try {
    e = JSON.parse(raw);
  } catch {
    return;
  }
  const ts = e.timestamp ? Date.parse(e.timestamp) : 0;
  if (ts) st.lastTs = Math.max(st.lastTs, ts);
  if (e.type === "title" && e.title) st.title = e.title;
  else if (e.type === "session") {
    st.id = e.id || "";
    st.cwd = e.cwd || st.cwd;
    st.startedAt = ts || st.startedAt;
    st.parentSession = e.parentSession || ""; // /new·핸드오프로 이어진 이전 세션(같은 omp 프로세스가 이어 쓴다)
  } else if (e.type === "model_change" && e.model) {
    // "provider/id" 형식이다. id 에도 / 가 들어갈 수 있어 첫 / 에서만 나눈다.
    const i = e.model.indexOf("/");
    if (i > 0) { st.provider = e.model.slice(0, i); st.model = e.model.slice(i + 1); } else st.model = e.model;
  } else if (e.type === "model_usage") {
    const c = (e.usage && e.usage.cost && e.usage.cost.total) || 0;
    st.cost += c;
    st.auxCost += c;
    st.auxRequests += 1;
  } else if (e.type === "custom") {
    const d = e.data || {};
    if (e.customType === "tool_execution_start") {
      const cur = st.tools.get(d.toolName) || { count: 0, lastTs: 0, intent: "" };
      cur.count += 1;
      cur.lastTs = ts || cur.lastTs;
      cur.intent = d.intent || cur.intent;
      st.tools.set(d.toolName, cur);
      if (d.toolName === "task") noteTasks(st, toolArgs(d.args));
      toolStart(st, d, ts);
    } else if (e.customType === "session_exit") {
      st.endedAt = ts || st.endedAt;
    }
  } else if (e.type === "custom_message" || e.type === "system") {
    noteText(st, String(e.content || ""), ts);
  } else if (e.type === "message") {
    const m = e.message || {};
    if (m.role === "user" || m.role === "assistant") st.turnOver = m.role === "assistant" && m.stopReason !== "toolUse";
    if (m.role === "user") onUser(st, m, ts);
    else if (m.role === "assistant") onAssistant(st, m, ts);
    else if (m.role === "toolResult") onToolResult(st, e, m, ts);
  }
}

module.exports = { newFileState, parentOf, notePath, ingest };
