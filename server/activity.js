// 활동 요약: 세션 기록(omp·Claude Code)의 툴 호출·결과·발화를 세션마다 증분으로 모아
// 목표·지금 하는 일·읽은 파일·고친 파일(+/− 줄)·명령(통과/실패)·결과 한 줄·최근 활동 10개로 만든다.
// 순수 모듈이다(파일·전역 상태 없음). ingest.js·harness/claude-msg.js 가 줄마다 부르고, snapshot.js 가 summary 로 노드에 싣는다.
"use strict";

const { resultsOf } = require("./agent-msgs");

const RECENT = 10, FILES = 40, COMMANDS = 30, PENDING = 50, HUNKS = 5, HUNK_TEXT = 4000;
const READ = /^(read|read_file|view|cat|notebookread)$/i;
const EDIT = /^(edit|multiedit|write|write_file|apply_patch|patch|str_replace|str_replace_editor|notebookedit|ast_edit)$/i;
const COMMAND = /^(bash|shell|exec|powershell|terminal)$/i;
const SEARCH = /^(grep|glob|find|search|ls|web_search|websearch|webfetch|fetch|lsp)$/i;
const PATH_KEYS = ["path", "file_path", "filePath", "file", "notebook_path"];

const one = (s, n = 140) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const firstLine = (s, n = 140) => one(String(s ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "", n);
const base = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
const lines = (s) => (typeof s === "string" && s.length ? s.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n") : []);
const pathOf = (a) => PATH_KEYS.map((k) => a[k]).find((v) => typeof v === "string" && v && v.length < 400 && !v.includes("\n")) || "";

function newActivity() {
  return { goal: "", lastSaid: "", stopError: false, pending: new Map(), recent: [], reads: [], edits: [], commands: [],
    counts: { reads: 0, edits: 0, add: 0, del: 0, commands: 0, ok: 0, fail: 0 }, spawned: new Map(), results: new Map(), diffs: new Map() };
}

// 바뀐 줄 수: 앞뒤 같은 줄을 빼고 남은 줄을 센다.
function lineDelta(oldText, newText) {
  const a = lines(oldText), b = lines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { add: b.length - head - tail, del: a.length - head - tail };
}

// 패치 글(apply_patch·unified diff) → [{ file, add, del, patch }]
function patchFiles(text, fallback) {
  const out = [];
  let cur = null;
  for (const line of lines(text)) {
    const head = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line) || /^\+\+\+ (?:b\/)?(.+)$/.exec(line) ||
      /^\[(.+?)#[0-9A-Za-z]+\]$/.exec(line.trim()); // omp hashline 편집: [파일#해시]
    if (head) { cur = { file: head[1].trim(), add: 0, del: 0, patch: [] }; out.push(cur); continue; }
    if (/^(---|\*\*\*|diff |index |@@)/.test(line) && !/^@@/.test(line)) continue;
    if (!cur) { cur = { file: fallback || "", add: 0, del: 0, patch: [] }; out.push(cur); }
    cur.patch.push(line);
    if (/^\+/.test(line)) cur.add++; else if (/^-/.test(line)) cur.del++;
  }
  return out.filter((x) => x.file).map((x) => ({ ...x, patch: x.patch.join("\n").slice(0, HUNK_TEXT) }));
}

// 편집 툴 인자 → [{ file, add, del, hunk }]
function editsOf(a) {
  const file = pathOf(a);
  const pick = (o, keys) => keys.map((k) => o[k]).find((v) => typeof v === "string");
  const OLD = ["oldText", "old_string", "old_text", "old", "search"], NEW = ["newText", "new_string", "new_text", "new", "replace"];
  const patch = pick(a, ["patch", "diff", "input"]);
  if (typeof patch === "string" && /^(\*\*\* |@@|\+\+\+ |--- |[+-]|\[[^\]\n]+#[0-9A-Za-z]+\]$)/m.test(patch)) return patchFiles(patch, file).map((x) => ({ file: x.file, add: x.add, del: x.del, hunk: { patch: x.patch } }));
  if (!file || /^agent:\/\//.test(file)) return [];
  const pairs = Array.isArray(a.edits) ? a.edits.filter((e) => e && typeof e === "object") : [a];
  const out = { file, add: 0, del: 0, hunk: null };
  let any = false;
  for (const e of pairs) {
    const o = pick(e, OLD), n = pick(e, NEW);
    if (o === undefined && n === undefined) continue;
    any = true;
    const d = lineDelta(o || "", n || "");
    out.add += d.add; out.del += d.del;
    out.hunk = { old: String(o || "").slice(0, HUNK_TEXT), new: String(n || "").slice(0, HUNK_TEXT) };
  }
  if (!any && typeof a.content === "string") { out.add = lines(a.content).length; out.hunk = { old: "", new: a.content.slice(0, HUNK_TEXT), write: true }; }
  return [out];
}

function push(act, item) {
  act.recent.push(item);
  if (act.recent.length > RECENT) act.recent.splice(0, act.recent.length - RECENT);
}
function noteFile(list, file, add = 0, del = 0) {
  let row = list.find((x) => x.file === file);
  if (!row) { row = { file, add: 0, del: 0, n: 0 }; list.push(row); if (list.length > FILES) list.shift(); }
  row.add += add; row.del += del; row.n += 1;
  return row;
}

// 툴 호출 하나(이름·인자). 결과가 오기 전까지 '지금 하는 일' 후보다.
function onCall(act, { id, name, args, ts }) {
  const a = args && typeof args === "object" ? args : {};
  const tool = String(name || "");
  let item;
  if (tool === "task" && Array.isArray(a.tasks)) {
    const names = [];
    for (const t of a.tasks) {
      if (!t || !t.name) continue;
      names.push(String(t.name));
      act.spawned.set(String(t.name), firstLine(t.description || t.task, 160));
    }
    item = { kind: "spawn", text: "서브에이전트 " + names.length + "개 · " + names.join(", "), n: names.length, names: names.slice(0, 6) };
  } else if (/^(task|agent)$/i.test(tool) && (a.prompt || a.description)) {
    if (id) act.spawned.set(String(id), firstLine(a.description || a.prompt, 160));
    item = { kind: "spawn", text: "서브에이전트 · " + firstLine(a.description || a.prompt, 80), n: 1, desc: firstLine(a.description || a.prompt, 80) };
  } else if (READ.test(tool) && pathOf(a)) {
    const file = pathOf(a);
    act.counts.reads++;
    noteFile(act.reads, file);
    item = { kind: "read", file, text: "읽음 " + base(file) };
  } else if (EDIT.test(tool) && editsOf(a).length) {
    const edits = editsOf(a);
    for (const e of edits) {
      act.counts.edits++; act.counts.add += e.add; act.counts.del += e.del;
      noteFile(act.edits, e.file, e.add, e.del);
      if (e.hunk) {
        if (!act.diffs.has(e.file) && act.diffs.size >= FILES) act.diffs.delete(act.diffs.keys().next().value);
        const list = act.diffs.get(e.file) || [];
        list.push({ ...e.hunk, ts: ts || 0, add: e.add, del: e.del });
        if (list.length > HUNKS) list.shift();
        act.diffs.set(e.file, list);
      }
    }
    const e = edits[0];
    const add = edits.reduce((s, x) => s + x.add, 0), del = edits.reduce((s, x) => s + x.del, 0);
    item = { kind: "edit", file: e.file, add, del, more: edits.length - 1, write: Boolean(e.hunk?.write), text: "수정 " + base(e.file) + (edits.length > 1 ? " 외 " + (edits.length - 1) : "") + " +" + add + " −" + del };
  } else if (COMMAND.test(tool) && typeof a.command === "string") {
    const cmd = one(a.command, 160);
    act.counts.commands++;
    const row = { cmd, ok: null, ts: ts || 0, id: id || "" };
    act.commands.push(row);
    if (act.commands.length > COMMANDS) act.commands.shift();
    item = { kind: "command", cmd, text: "명령 " + cmd };
  } else if (SEARCH.test(tool)) {
    item = { kind: "search", query: one(a.pattern || a.query || a.url || a.path || "", 80), text: "찾기 " + one(a.pattern || a.query || a.url || a.path || "", 80) };
  } else if (tool === "write" && /^agent:\/\//.test(String(a.path || ""))) {
    item = { kind: "spawn", text: "후속 지시 → " + String(a.path).slice(8, 60), n: 0 };
  } else item = { kind: "tool", text: tool + (pathOf(a) ? " " + base(pathOf(a)) : "") };
  Object.assign(item, { ts: ts || 0, tool, id: id || "" });
  push(act, item);
  if (id) {
    act.pending.set(String(id), item);
    if (act.pending.size > PENDING) act.pending.delete(act.pending.keys().next().value);
  }
}

// 툴 결과 하나: 도는 툴을 닫고 명령 통과/실패를 적는다.
function onResult(act, { id, error, text, ts }) {
  const item = act.pending.get(String(id || ""));
  act.pending.delete(String(id || ""));
  if (String(text || "").includes("<task-result")) onNotice(act, String(text), ts || 0);
  const failed = Boolean(error) || /\b(exit(?:ed with)? code[: ]+[1-9]\d*)/i.test(String(text || "").slice(-400));
  if (item) item.ok = !failed;
  const row = act.commands.find((c) => c.id && c.id === String(id || ""));
  if (row && row.ok === null) { row.ok = !failed; act.counts[row.ok ? "ok" : "fail"]++; if (item) item.text = "명령 " + (row.ok ? "✓ " : "✗ ") + row.cmd; }
  if (item && item.kind === "spawn" && failed && id) act.results.set(String(id), { status: "failed", text: firstLine(text, 160) });
  else if (item && item.kind === "spawn" && id && text) act.results.set(String(id), { status: "completed", text: firstLine(text, 160) });
}

function onUserText(act, text, ts) {
  const t = String(text || "");
  if (/^\s*<system-notice>/.test(t) || /<task-result\s/.test(t)) return onNotice(act, t, ts);
  if (!t.trim()) return;
  if (!act.goal) act.goal = firstLine(t, 200);
  push(act, { kind: "user", ts: ts || 0, text: "지시: " + one(t, 100) });
}
function onAssistantText(act, text, ts, stopError = false) {
  act.stopError = Boolean(stopError);
  if (!text || !String(text).trim()) return;
  act.lastSaid = String(text).slice(0, 600);
  push(act, { kind: "say", ts: ts || 0, text: one(text, 110) });
}
// 서브에이전트 결과 안내문(<task-result id agent status>) → 이름별 결과.
function onNotice(act, text, ts) {
  for (const r of resultsOf(text)) {
    act.results.set(r.id, { status: r.status, text: firstLine(r.text, 160) });
    push(act, { kind: "result", ts: ts || 0, who: r.id, status: r.status || "", text: "결과 " + r.id + " · " + (r.status || "완료") + (r.text ? " · " + one(r.text, 60) : "") });
  }
}

const STATE = { live: "running", done: "done", idle: "waiting" };
const VIEW_KEYS = ["file", "ok", "cmd", "add", "del", "more", "write", "n", "names", "desc", "query", "who", "status"];
function view(item) {
  const out = { kind: item.kind, ts: item.ts, text: item.text, tool: item.tool || "" };
  for (const key of VIEW_KEYS) if (item[key] !== undefined && item[key] !== "" && !(key === "more" && !item[key]) && !(key === "write" && !item[key])) out[key] = item[key];
  return out;
}
// 노드에 싣는 모양. status: 스냅샷 노드 상태(live·idle·done). extra: 부모가 준 목표·결과(activity-tree.js).
function summary(act, status, extra = {}) {
  const a = act || newActivity();
  const failed = extra.failed || (status !== "live" && a.stopError);
  const state = failed ? "failed" : status === "idle" && extra.turnOver ? "done" : STATE[status] || "waiting"; // 차례를 마치고 쉬는 세션은 완료(결과 한 줄)
  const pending = [...a.pending.values()];
  let now = "";
  if (state === "running") {
    const p = pending.at(-1);
    if (p) now = p.kind === "edit" ? base(p.file) + " 수정 중" : p.kind === "read" ? base(p.file) + " 읽는 중"
      : p.kind === "command" ? "명령 실행 중 · " + one(p.cmd, 60) : p.kind === "spawn" ? "서브에이전트 " + (pending.filter((x) => x.kind === "spawn").reduce((s, x) => s + (x.n || 1), 0)) + "개 기다리는 중"
      : p.kind === "search" ? p.text.replace(/^찾기/, "찾는 중 ·") : p.tool + " 실행 중";
    else now = a.recent.at(-1)?.kind === "say" ? "응답 쓰는 중 · " + one(a.lastSaid, 60) : "생각 중";
  }
  return {
    goal: extra.goal || a.goal, status: state, currentActivity: now,
    reads: a.reads.map(({ file, n }) => ({ file, n })), edits: a.edits.map(({ file, add, del, n }) => ({ file, add, del, n })),
    commands: a.commands.map(({ cmd, ok, ts }) => ({ cmd, ok, ts })), counts: { ...a.counts },
    resultSummary: state === "running" ? "" : extra.result || firstLine(a.lastSaid, 160),
    // 화면 문장(ui/js/model/agent-lines.js)이 쓰는 구조 필드도 함께 싣는다: 명령·줄 수·서브에이전트 이름·찾은 말·결과 상대.
    recent: a.recent.map(view),
    now: state === "running" && pending.length ? view(pending.at(-1)) : null,
    waitingSubs: pending.filter((x) => x.kind === "spawn").reduce((s, x) => s + (x.n || 1), 0),
    children: extra.children || [],
  };
}

module.exports = { newActivity, onCall, onResult, onUserText, onAssistantText, onNotice, summary, editsOf, lineDelta, patchFiles, base };
