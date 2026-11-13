// 실시간 변환: omp rpc 프레임을 live 이벤트로 바꿔 방송. 서브에이전트 표와 직전 출력 표 소유.
"use strict";

const { pushLive } = require("./sse");

const MAX = 500;
const subs = new Map(); // mainFile + 서브에이전트 id -> sessionFile
const outs = new Map(); // node + toolCallId -> 직전 출력
const tools = new Map(); // node + toolCallId -> {name, args} (도는 툴 되살리기용)
const lens = new Map(); // node + 종류 + contentIndex -> 직전 글 길이(전체 메시지로 올 때만)

// 표가 MAX를 넘으면 오래된 것부터 지운다.
function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX) map.delete(map.keys().next().value);
}

function textOf(result) {
  const parts = result && Array.isArray(result.content) ? result.content : [];
  let text = "";
  for (const p of parts) if (p && p.type === "text" && typeof p.text === "string") text += p.text;
  return text;
}

// delta가 없고 전체 메시지만 오면 직전 길이와 비교해 늘어난 부분만 돌려준다.
function grown(node, kind, ev) {
  if (typeof ev.delta === "string") return ev.delta;
  const part = ev.partial && Array.isArray(ev.partial.content) ? ev.partial.content[ev.contentIndex || 0] : null;
  const full = part ? (kind === "think" ? part.thinking : part.text) : null;
  if (typeof full !== "string") return "";
  const key = `${node}\n${kind}\n${ev.contentIndex || 0}`;
  const prev = lens.get(key) || 0;
  remember(lens, key, full.length);
  return full.length > prev ? full.slice(prev) : "";
}

function forgetLens(node) {
  for (const key of lens.keys()) if (key.startsWith(`${node}\n`)) lens.delete(key);
}

function onMessage(node, ev) {
  if (!ev) return;
  const kind = ev.type === "text_delta" ? "text" : ev.type === "thinking_delta" ? "think" : "";
  if (!kind) return;
  const text = grown(node, kind, ev);
  if (text) pushLive({ node, kind, text });
}

function onOut(node, e) {
  const text = textOf(e.partialResult).slice(-4000);
  const key = `${node}\n${e.toolCallId}`;
  if (outs.get(key) === text) return;
  if (!text && !outs.has(key)) return;
  remember(outs, key, text);
  pushLive({ node, kind: "out", id: e.toolCallId, text });
}

// 메인과 서브에이전트가 같이 쓰는 변환기. node만 다르다.
function convert(node, e) {
  switch (e.type) {
    case "message_update":
      onMessage(node, e.assistantMessageEvent);
      break;
    case "message_end":
      forgetLens(node);
      break;
    case "tool_execution_start": {
      let args = "";
      try { args = JSON.stringify(e.args) || ""; } catch {}
      remember(tools, `${node}\n${e.toolCallId}`, { name: e.toolName, args: args.slice(0, 500) });
      pushLive({ node, kind: "tool", id: e.toolCallId, name: e.toolName, args: args.slice(0, 500) });
      break;
    }
    case "tool_execution_update":
      onOut(node, e);
      break;
    case "tool_execution_end":
      tools.delete(`${node}\n${e.toolCallId}`);
      pushLive({ node, kind: "tool_end", id: e.toolCallId, error: !!(e.isError || (e.result && e.result.isError)) });
      break;
    case "agent_end":
      pushLive({ node, kind: "turn_end" });
      break;
  }
}

function handle(mainFile, e) {
  if (!mainFile || !e || typeof e !== "object") return;
  const p = e.payload;
  if (e.type === "subagent_lifecycle") {
    if (!p || !p.id) return;
    if (p.sessionFile) remember(subs, `${mainFile}\n${p.id}`, p.sessionFile);
    const node = p.sessionFile || subs.get(`${mainFile}\n${p.id}`);
    if (node) pushLive({ node, kind: "sub", status: p.status, name: p.id });
    return;
  }
  if (e.type === "subagent_event") {
    const node = p && subs.get(`${mainFile}\n${p.id}`);
    if (node && p.event) convert(node, p.event);
    return;
  }
  convert(mainFile, e);
}

// 새로 붙은 화면이 이미 지나간 출력을 되살릴 수 있게 툴별 마지막 출력을 준다.
function outsFor(node) {
  const key = String(node || "").replace(/\\/g, "/").toLowerCase();
  const list = [];
  for (const [k, text] of outs) {
    const i = k.indexOf("\n");
    if (String(k.slice(0, i)).replace(/\\/g, "/").toLowerCase() !== key) continue;
    if (!text) continue;
    const t = tools.get(k) || { name: "", args: "" };
    list.push({ id: k.slice(i + 1), name: t.name, args: t.args, text });
  }
  return list;
}

module.exports = { handle, outsFor };
