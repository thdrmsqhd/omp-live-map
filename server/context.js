// 세션 기록에서 지금 유효한 컨텍스트(마지막 압축 요약 + 그 뒤로 남은 항목)를 복원한다. 파일은 읽기만 한다.
// omp 는 압축할 때 type:"compaction" 엔트리를 남기고, firstKeptEntryId 부터를 유지한다. reset_boundary 는 그 앞을 버린다.
"use strict";

const fs = require("fs");
const path = require("path");
const { SESSIONS } = require("./config");

const PREVIEW = 2000; // 화면으로 보내는 본문 상한(토큰 수는 원문 길이로 센다)
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;

// 대략 토큰: CJK 1자 ≈ 1토큰, 그 외 4자 ≈ 1토큰. 표시용 근사치다.
function estTokens(s) {
  const t = String(s || "");
  const cjk = (t.match(CJK) || []).length;
  return Math.round(cjk + (t.length - cjk) / 4);
}

// node(세션 파일 경로)가 세션 폴더 안의 .jsonl 일 때만 정규화한 경로를 돌려준다.
function safeFile(node) {
  const file = path.resolve(String(node || ""));
  const root = path.resolve(SESSIONS);
  if (!file.startsWith(root + path.sep) || !file.endsWith(".jsonl")) return null;
  return file;
}

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let e;
    try { e = JSON.parse(t); } catch { continue; }
    if (e && typeof e === "object" && e.type) out.push(e);
  }
  return out;
}

// 마지막 엔트리에서 parentId 를 따라 올라가 지금 브랜치만 남긴다(포크·트리 이동 뒤에도 유효한 순서).
// session·title 은 세션 머리말이지 대화 엔트리가 아니라 인덱스에서 뺀다. id 가 아예 없는 오래된 기록은 파일 순서를 쓴다.
function chainOf(entries) {
  const byId = new Map();
  for (const e of entries) if (e.id && e.type !== "session" && e.type !== "title") byId.set(e.id, e);
  if (!byId.size) return entries;
  let leaf = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (byId.has(entries[i].id)) { leaf = entries[i]; break; }
  }
  const out = [];
  const seen = new Set();
  while (leaf && !seen.has(leaf.id)) {
    seen.add(leaf.id);
    out.push(leaf);
    leaf = leaf.parentId ? byId.get(leaf.parentId) : null;
  }
  const chain = out.reverse();
  // 브랜치를 따라가도 대화가 안 나오면(부모 사슬이 끊긴 기록) 파일 순서로 되돌린다.
  return chain.some((e) => e.type === "message") ? chain : entries;
}

const lastIndex = (list, type) => {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].type === type) return i;
  return -1;
};

// 컨텍스트에 남는 첫 엔트리 위치. 마지막 압축(없으면 reset_boundary)보다 앞은 모델에게 가지 않는다.
function startIndex(chain) {
  const reset = lastIndex(chain, "reset_boundary");
  const u = lastIndex(chain, "compaction");
  const comp = reset > u ? -1 : u;
  if (comp < 0) return reset + 1;
  const keepId = chain[comp].firstKeptEntryId;
  const keep = keepId ? chain.findIndex((e, i) => i > reset && i < comp && e.id === keepId) : -1;
  return keep >= 0 ? keep : comp;
}

const blocksOf = (m) => (typeof m.content === "string" ? [{ type: "text", text: m.content }]
  : Array.isArray(m.content) ? m.content : []);

const textOf = (content) => (typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((c) => c && c.type === "text").map((c) => c.text || "").join("\n") : "");

// 엔트리 하나를 화면 항목으로. 보여 줄 내용이 없는 엔트리는 null.
function itemOf(e, ts) {
  if (e.type === "compaction") {
    return { kind: "summary", text: String(e.summary || ""), ts,
      before: e.tokensBefore || 0, after: e.tokensAfter || 0 };
  }
  if (e.type === "branch_summary") return { kind: "note", label: "브랜치 요약", text: String(e.summary || e.content || ""), ts };
  if (e.type === "custom_message") {
    const text = String(e.content || "");
    return text.trim() ? { kind: "note", label: String(e.customType || "시스템"), text, ts } : null;
  }
  if (e.type !== "message" || !e.message) return null;
  const m = e.message;
  if (m.role === "user" || m.role === "developer") {
    const text = textOf(m.content);
    return text.trim() ? { kind: m.role === "developer" ? "note" : "user", text, ts } : null;
  }
  if (m.role === "assistant") {
    const blocks = blocksOf(m);
    const text = blocks.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n");
    const tools = blocks.filter((b) => b && b.type === "toolCall" && b.name).map((b) => b.name);
    if (!text.trim() && !tools.length) return null;
    return { kind: "ai", text, tools: [...new Set(tools)], ts };
  }
  if (m.role === "toolResult") {
    return { kind: "tool", tool: m.toolName || "tool", text: textOf(m.content),
      error: !!(m.isError || e.errorMessage), ts };
  }
  if (m.role === "bashExecution") return { kind: "tool", tool: "bash", text: String(m.output || m.command || ""), ts };
  return null;
}

const KIND_LABEL = { summary: "압축 요약", user: "사용자", ai: "에이전트", tool: "도구 결과", note: "시스템" };

// 파일 하나의 현재 컨텍스트. { items, totalTokens } — 항목은 컨텍스트에 실리는 순서 그대로다.
function readContext(file) {
  const chain = chainOf(parse(file));
  const start = startIndex(chain);
  const items = [];
  for (let i = start; i < chain.length; i++) {
    const e = chain[i];
    const ts = e.timestamp ? Date.parse(e.timestamp) : 0;
    const it = itemOf(e, ts);
    if (!it) continue;
    const chars = it.text.length;
    it.i = items.length + 1;
    it.role = it.kind;
    it.label = it.label || KIND_LABEL[it.kind] || it.kind;
    it.chars = chars;
    it.tokens = estTokens(it.text);
    it.trunc = chars > PREVIEW;
    if (it.trunc) it.text = it.text.slice(0, PREVIEW) + "…";
    items.push(it);
  }
  return { items, totalTokens: items.reduce((s, it) => s + it.tokens, 0) };
}

// 압축 지시문: 사용자가 쓴 작업 가이드 + 요약에서 빼라고 고른 항목 설명.
function compactInstructions(guide, omit, items) {
  const parts = [];
  if (guide) parts.push(String(guide).trim());
  const picked = (Array.isArray(omit) ? omit : [])
    .map((i) => items.find((it) => it.i === Number(i)))
    .filter(Boolean);
  if (picked.length) {
    parts.push("새 압축 요약에서 아래 항목의 내용은 빼라(진행에 필요한 결론만 남겨라):\n"
      + picked.map((it) => `- #${it.i} ${it.label}${it.tool ? " " + it.tool : ""}: ${String(it.text).replace(/\s+/g, " ").slice(0, 90)}`).join("\n"));
  }
  return parts.join("\n\n");
}

module.exports = { readContext, compactInstructions, safeFile };
