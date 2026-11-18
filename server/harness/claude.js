// Claude Code 기록 읽기: ~/.claude/projects/<슬러그>/<sessionId>.jsonl 을 증분 파싱해 omp 스냅샷과 같은
// 파일 상태 모양으로 만든다. 원본 파일은 절대 쓰지 않는다. 하네스별 차이는 이 모듈과 claude-run.js 에만 있다.
"use strict";

const fs = require("fs");
const path = require("path");
const { CLAUDE_PROJECTS, HOURS } = require("../config");
const { recordUser, recordAssistant, noteHourly } = require("../turns");
const lineage = require("../lineage");
const pending = require("./claude-pending");

const files = new Map(); // 절대 경로 -> { offset, pending, st }
const MAX_PENDING = 1_048_576;

// 작업 폴더 → Claude Code 프로젝트 슬러그(영숫자가 아닌 글자는 모두 -).
const slug = (cwd) => String(cwd || "").replace(/[^A-Za-z0-9]/g, "-");
const dirOf = (cwd) => path.join(CLAUDE_PROJECTS, slug(cwd));
const fileFor = (cwd, sessionId) => path.join(dirOf(cwd), sessionId + ".jsonl");

function newState(file) {
  const id = path.basename(file, ".jsonl");
  return {
    harness: "claude", file, sessionId: id, mainFile: file, sessionKey: "claude|" + id,
    rel: path.basename(path.dirname(file)) + "/" + path.basename(file), depth: 2,
    name: "main", kind: "main", parent: null,
    title: "", firstUser: "", lastUser: "", lastAssistant: "", cwd: "",
    model: "", provider: "", startedAt: 0, lastTs: 0, endedAt: 0, turnOver: false,
    requests: 0, turns: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0, auxCost: 0, auxRequests: 0, hourly: [], durationSum: 0, ttftSum: 0, ttftN: 0,
    recent: [], tools: new Map(), commands: [], files: [], errors: 0, ctx: null, messages: [],
    jobs: [], active: new Map(), taskProfiles: new Map(), liveq: [],
  };
}

// assistant usage → omp 가 쓰는 모양. 캐시 생성·읽기는 새 입력과 별도 토큰이다.
function usageOf(u) {
  const x = u || {};
  const input = x.input_tokens || 0, output = x.output_tokens || 0;
  const cacheRead = x.cache_read_input_tokens || 0, cacheWrite = x.cache_creation_input_tokens || 0;
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite };
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

function noteTool(st, name, input, ts) {
  const cur = st.tools.get(name) || { count: 0, lastTs: 0, intent: "" };
  cur.count += 1;
  cur.lastTs = ts || cur.lastTs;
  st.tools.set(name, cur);
  const a = input && typeof input === "object" ? input : {};
  if (typeof a.command === "string") st.commands = [{ cmd: a.command.slice(0, 140), ts }, ...st.commands].slice(0, 8);
  if (typeof a.file_path === "string" && a.file_path.length < 400) {
    st.files = [{ p: a.file_path, ts }, ...st.files.filter((f) => f.p !== a.file_path)].slice(0, 12);
  }
}

function onAssistant(st, o, ts) {
  const m = o.message || {};
  const u = usageOf(m.usage);
  st.requests += 1;
  if (m.model) st.model = m.model;
  st.usage.input += u.input;
  st.usage.output += u.output;
  st.usage.cacheRead += u.cacheRead;
  st.usage.cacheWrite += u.cacheWrite;
  st.usage.total += u.totalTokens;
  noteHourly(st, u, ts);
  if (st.lastTs && ts > st.lastTs) {
    const dur = Math.min(600_000, ts - st.lastTs);
    st.durationSum += dur;
    st.recent.push({ ts, out: u.output, dur });
    if (st.recent.length > 30) st.recent.shift();
  }
  // 컨텍스트 프롬프트 = 캐시 읽기 + 캐시 생성 + 새 입력. 구성 비율은 Claude 기록에 없어 0 으로 둔다.
  st.ctx = { promptTokens: u.input + u.cacheRead + u.cacheWrite, nonMessageTokens: 0, toolSchemaTokens: 0, compactionEpoch: 0 };
  const blocks = Array.isArray(m.content) ? m.content : [];
  const said = blocks.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  const tools = [];
  for (const b of blocks) {
    if (!b || b.type !== "tool_use") continue;
    if (b.name) { tools.push(b.name); noteTool(st, b.name, b.input, ts); }
  }
  st.turnOver = tools.length === 0;
  recordAssistant(st, said, [...new Set(tools)], ts);
}

function onUser(st, o, ts) {
  // sidechain 레코드는 서브에이전트 기록 파일의 본문이다. 메인 파일에 섞여 오면 버린다.
  if (o.isSidechain && !st.sidechain) return;
  const m = o.message || {};
  const text = textOf(m.content);
  if (!text.trim()) return; // tool_result 만 있는 사용자 레코드
  st.turns += 1;
  st.turnOver = false;
  if (!st.firstUser) st.firstUser = text.replace(/\s+/g, " ").slice(0, 120);
  st.lastUser = text.replace(/\s+/g, " ").slice(0, 300);
  recordUser(st, text, ts);
}

function ingestLine(st, raw) {
  let o;
  try { o = JSON.parse(raw); } catch { return; }
  const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
  if (ts) {
    st.lastTs = Math.max(st.lastTs, ts);
    if (!st.startedAt || ts < st.startedAt) st.startedAt = ts;
  }
  if (o.cwd && !st.cwd) st.cwd = o.cwd;
  switch (o.type) {
    case "custom-title":
      if (o.customTitle) st.title = String(o.customTitle);
      break;
    case "cost-state":
      // 누적 비용(USD). 뒤에 오는 갱신 레코드가 덮어쓴다.
      if (typeof o.totalCostUSD === "number") st.cost = o.totalCostUSD;
      break;
    case "user":
      onUser(st, o, ts);
      break;
    case "assistant":
      onAssistant(st, o, ts);
      break;
    default:
      break;
  }
}

function readNew(rec) {
  let size;
  try { size = fs.statSync(rec.st.file).size; } catch { return; }
  if (size < rec.offset) { rec.offset = 0; rec.pending = ""; }
  if (size === rec.offset) return;
  const bytes = size - rec.offset;
  const buf = Buffer.allocUnsafe(bytes);
  const fd = fs.openSync(rec.st.file, "r");
  try { fs.readSync(fd, buf, 0, bytes, rec.offset); } finally { fs.closeSync(fd); }
  rec.offset = size;
  const lines = (rec.pending + buf.toString("utf8")).split("\n");
  rec.pending = lines.pop() || "";
  if (rec.pending.length > MAX_PENDING) rec.pending = "";
  for (const line of lines) if (line.trim()) ingestLine(rec.st, line);
}

function track(file, cutoff) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  if (stat.mtimeMs < cutoff) return; // 기간 밖 파일은 읽지 않는다(오래된 기록이 수백 MB 쌓인다)
  let rec = files.get(file);
  if (!rec) {
    rec = { offset: 0, pending: "", st: newState(file) };
    files.set(file, rec);
  }
  if (!rec.st.lastTs) rec.st.lastTs = stat.mtimeMs;
  readNew(rec);
}

// ~/.claude/projects/<슬러그>/*.jsonl 만 읽는다(중첩 폴더의 sidechain 파일은 쓰지 않는다).
function scan() {
  const cutoff = Date.now() - Math.max(HOURS, 24) * 3_600_000;
  let dirs;
  try { dirs = fs.readdirSync(CLAUDE_PROJECTS, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let names;
    try { names = fs.readdirSync(path.join(CLAUDE_PROJECTS, d.name), { withFileTypes: true }); } catch { continue; }
    for (const ent of names) {
      if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
      const file = path.join(CLAUDE_PROJECTS, d.name, ent.name);
      track(file, cutoff);
      const sessionId = path.basename(file, ".jsonl");
      require("./claude-sub").scanDir(path.join(CLAUDE_PROJECTS, d.name, sessionId, "subagents"), sessionId, file, cutoff);
    }
  }
}

function states() {
  return [...files.values()].map((r) => r.st).concat(require("./claude-sub").states());
}

function stateOf(file) {
  const rec = files.get(path.normalize(String(file || "")));
  return rec ? rec.st : null;
}

module.exports = { scan, states, stateOf, newState, ingestLine, pendingOf: pending.of, beginPending: pending.begin,
  slug, dirOf, fileFor };
