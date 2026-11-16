// 잡·툴 추적: JSONL 한 줄에서 "지금 도는 툴"과 백그라운드 잡의 상태·출력 꼬리를 갱신한다.
// 기록에는 툴 결과가 끝날 때만 출력이 실리므로 TUI 세션의 출력은 끝날 때 한 번에 온다(server/active.js 로 방송).
"use strict";

const JOB_KEEP = 16;    // 세션당 보관 잡 수
const TAIL_LINES = 60;  // 잡·툴 출력 꼬리 줄 수
const QUEUE_MAX = 200;  // 방송 대기 이벤트 수

function queue(st, ev) {
  if (!st.liveq) st.liveq = [];
  st.liveq.push(ev);
  if (st.liveq.length > QUEUE_MAX) st.liveq.splice(0, st.liveq.length - QUEUE_MAX);
}

// 카드 한 줄에 들어갈 짧은 인자. bash 는 명령, 나머지는 경로·의도.
function shortArgs(name, a) {
  if (!a || typeof a !== "object") return "";
  const pick = name === "bash"
    ? a.command
    : a.path || a.file_path || a.filePath || a.intent || a.description || a.pattern || a.query || a.url || a.prompt;
  const s = String(pick || "").replace(/\s+/g, " ").trim();
  return s.length > 220 ? s.slice(0, 220) : s;
}

function toolStart(st, d, ts) {
  if (!d || !d.toolCallId) return;
  if (!st.active) st.active = new Map();
  const item = { id: d.toolCallId, name: d.toolName || "", args: shortArgs(d.toolName, d.args), ts: ts || Date.now() };
  st.active.set(item.id, item);
  // 잡 카드의 명령줄은 툴 결과에 없으므로 시작할 때 적어 둔다.
  if (d.toolName === "bash" && d.args && typeof d.args.command === "string") st.toolCmds.set(item.id, d.args.command.slice(0, 300));
  queue(st, { kind: "tool", id: item.id, name: item.name, args: item.args });
}

function toolEnd(st, id) {
  if (!st.active || !id) return null;
  const item = st.active.get(id) || null;
  st.active.delete(id);
  return item;
}

// 잡 등록. 명령은 툴 인자에서 이미 뽑아 둔 st.toolCmds 를 쓴다.
function addJob(st, id, cmd, ts, toolCallId) {
  if (st.jobs.some((j) => j.id === id)) return;
  st.jobs.push({ id, cmd: cmd || "", ts: ts || st.lastTs, startedAt: ts || st.lastTs, toolCallId: toolCallId || "", done: false, status: "running", tail: [] });
  // 툴 한 칸은 "잡을 띄웠다"로 접는다(출력은 잡 카드만 보여준다).
  if (toolCallId) queue(st, { kind: "tool_job", id: toolCallId, job: id });
  while (st.jobs.length > JOB_KEEP) st.jobs.shift();
}

function endJob(st, id, status, ts) {
  const job = st.jobs.find((j) => j.id === id);
  if (!job || job.done) return;
  job.done = true;
  job.endedAt = ts || st.lastTs;
  job.status = status;
}

// 잡이 끝나며 붙는 안내문에서 출력 줄을 뽑아 잡 카드의 꼬리로 남긴다.
function jobOutput(text) {
  const i = text.search(/result below\.?/i);
  const body = i >= 0 ? text.slice(i).replace(/^result below\.?[^\n]*\n?/i, "") : "";
  const lines = body.replace(/<\/system-notice>\s*$/i, "").replace(/\s+$/, "").split("\n");
  return lines.filter((l) => l.length || lines.length < 3).slice(-TAIL_LINES);
}

// bg_N 이 언급된 안내문 하나를 모든 잡에 반영한다(끝난 잡은 출력만 채운다).
function noteText(st, text, ts) {
  if (!text || text.indexOf("bg_") < 0) return;
  const lines = jobOutput(text);
  const done = /completed|failed|exit code|Supervised process/i.test(text);
  const status = /fail|exit code|error/i.test(text) ? "failed" : "completed";
  for (const m of text.matchAll(/bg_\d+/g)) {
    const job = st.jobs.find((j) => j.id === m[0]);
    if (!job) continue;
    if (done) endJob(st, job.id, status, ts);
    if (lines.length) job.tail = lines;
    queue(st, { kind: "job", job: { id: job.id, done: job.done, status: job.status, tail: job.tail } });
  }
}

// 툴 결과: 도는 툴을 닫고 출력을 방송한다. 백그라운드로 넘어간 잡이면 잡으로 등록한다.
function toolResult(st, e, m, ts) {
  const text = typeof m.content === "string"
    ? m.content
    : Array.isArray(m.content) ? m.content.map((c) => (c && c.text) || "").join(" ") : "";
  const id = m.toolCallId || "";
  const item = toolEnd(st, id);
  if (item) {
    const lines = text.replace(/\s+$/, "").split("\n").slice(-TAIL_LINES);
    queue(st, { kind: "out", id, text: lines.join("\n") });
    queue(st, { kind: "tool_end", id, error: !!e.errorMessage });
  }
  const bg = text.match(/Backgrounded[^]*?job (bg_\d+)/);
  if (bg) addJob(st, bg[1], st.toolCmds.get(id) || "", ts, id);
  // wait 같은 도구 결과에는 잡 상태 목록이 구조화되어 실린다. proc://bg_N/kill 결과는 details.proc.jobs 에 실린다.
  const d = m.details || {};
  for (const j of [...(d.jobs || []), ...((d.proc && d.proc.jobs) || [])]) {
    if (!j || !j.id || !j.status || j.status === "running") continue;
    endJob(st, j.id, j.status === "completed" || j.status === "cancelled" ? j.status : "failed", ts);
  }
}

module.exports = { toolStart, toolEnd, addJob, endJob, noteText, toolResult, shortArgs };
