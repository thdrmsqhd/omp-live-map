// 확장 UI 요청(ask·select·confirm·input·editor): 세션 노드별 대기 질문 소유, 답 전송, SSE 방송.
"use strict";

const { pushAsk, pushLive } = require("./sse");
const lineage = require("./lineage");

const ASKS = ["ask", "select", "confirm", "input", "editor"]; // 화면에 카드로 보여 주는 method
const pending = new Map(); // node 키 -> Map(요청 id -> { node, request, s })

const keyOf = (node) => String(node || "").replace(/\\/g, "/").toLowerCase();

function mapOf(node) {
  const k = keyOf(node);
  let m = pending.get(k);
  if (!m) { m = new Map(); pending.set(k, m); }
  return m;
}

// ask 의 질문 하나. options 의 label 은 답으로 그대로 돌아가야 하므로 원문을 유지한다.
function questionOf(q) {
  return {
    id: String(q.id ?? ""),
    question: String(q.question ?? ""),
    header: q.header ? String(q.header) : "",
    multi: !!q.multi,
    recommended: Number.isInteger(q.recommended) ? q.recommended : -1,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
      label: String((o && o.label) ?? ""),
      description: o && o.description ? String(o.description) : "",
      preview: o && o.preview ? String(o.preview) : "",
    })),
  };
}

// 화면이 그릴 수 있는 필드만 추린다(나머지는 버린다).
function shape(e) {
  const base = { id: String(e.id ?? ""), method: e.method, timeout: Number(e.timeout) || 0 };
  if (e.method === "ask") return { ...base, questions: (Array.isArray(e.questions) ? e.questions : []).map(questionOf) };
  if (e.method === "select") {
    return {
      ...base,
      title: String(e.title ?? ""),
      options: (Array.isArray(e.options) ? e.options : []).map(String),
      optionDetails: (Array.isArray(e.optionDetails) ? e.optionDetails : []).map((d) => ({ description: d && d.description ? String(d.description) : "" })),
      initialIndex: Number.isInteger(e.initialIndex) ? e.initialIndex : 0,
      selectionMarker: e.selectionMarker === "checkbox" ? "checkbox" : "radio",
      checkedIndices: (Array.isArray(e.checkedIndices) ? e.checkedIndices : []).filter(Number.isInteger),
      markableCount: Number.isInteger(e.markableCount) ? e.markableCount : 0,
    };
  }
  if (e.method === "confirm") return { ...base, title: String(e.title ?? ""), message: String(e.message ?? "") };
  if (e.method === "input") return { ...base, title: String(e.title ?? ""), placeholder: String(e.placeholder ?? ""), secret: !!e.secret };
  return { ...base, title: String(e.title ?? ""), prefill: String(e.prefill ?? ""), promptStyle: String(e.promptStyle ?? "") };
}

// 화면이 보낸 답을 omp 계약 모양으로 추린다. 잉여 필드는 버린다.
function responseFor(method, r) {
  const src = r && typeof r === "object" ? r : {};
  if (src.cancelled) return { cancelled: true };
  if (src.timedOut) return { timedOut: true };
  if (method === "ask") {
    return {
      answers: (Array.isArray(src.answers) ? src.answers : []).map((a) => {
        const out = {
          id: String((a && a.id) ?? ""),
          selectedOptions: (Array.isArray(a && a.selectedOptions) ? a.selectedOptions : []).map(String),
        };
        const custom = a && typeof a.customInput === "string" ? a.customInput : "";
        if (custom) out.customInput = custom;
        return out;
      }),
    };
  }
  if (method === "confirm") return { confirmed: !!(r && r.confirmed) };
  return { value: String((r && r.value) ?? "") };
}

function take(node, id) {
  const m = pending.get(keyOf(node));
  const entry = m && m.get(String(id));
  if (!entry) return null;
  m.delete(String(id));
  if (!m.size) pending.delete(keyOf(node));
  return entry;
}

// 대기 요청을 모두 지우고 화면에도 닫으라고 알린다. 턴 종료·프로세스 종료에서 쓴다.
function drop(node) {
  const m = pending.get(keyOf(node));
  if (!m) return;
  pending.delete(keyOf(node));
  for (const id of m.keys()) pushAsk({ node, kind: "del", id });
}

// rpc 프레임을 받아 대기 목록을 갱신한다. start() 직후 bind 로 한 번 잇는다.
function onRequest(s, e) {
  const node = s.node;
  if (e.method === "cancel") {
    if (take(node, e.targetId)) pushAsk({ node, kind: "del", id: String(e.targetId) });
    return;
  }
  if (e.method === "notify") {
    const text = [e.title, e.message, e.text].filter((v) => typeof v === "string" && v).join(" · ");
    if (text) pushLive({ node, kind: "notify", text: text.slice(0, 300) });
    return;
  }
  if (!ASKS.includes(e.method)) return; // setStatus·setWidget·setTitle·openUrl 등은 화면에 필요 없다
  const request = shape(e);
  if (!request.id) return;
  mapOf(node).set(request.id, { node, request, s });
  pushAsk({ node, kind: "add", request });
}

// 대기 중인 질문이 있어야 ask 를 보내 준다. 세션 ready 직후 한 번 보낸다.
function bind(s) {
  s.rpc.onEvent((e) => {
    if (!e) return;
    // 턴이 끝났으면 남은 질문은 omp 가 이미 스스로 해소한 것으로 본다(시한 초과·중단 포함).
    if (e.type === "agent_end") drop(s.node);
    else if (e.type === "extension_ui_request") onRequest(s, e);
  });
  s.rpc.child.on("close", () => drop(s.node));
  s.rpc.send({ type: "set_ask_dialog", enabled: true }).catch(() => {});
}

// 화면이 보낸 답. 없는 id·이미 해소된 id 는 거절한다.
function answer(node, id, response) {
  const entry = take(lineage.resolve(node), id); // 카드 id 로 온 답을 지금 실제 파일의 질문으로
  if (!entry) return { ok: false, out: "없거나 이미 해소된 질문입니다" };
  const frame = { type: "extension_ui_response", id: entry.request.id, ...responseFor(entry.request.method, response) };
  const sent = entry.s.rpc.sendRaw(frame);
  pushAsk({ node: entry.node, kind: "del", id: entry.request.id });
  return sent ? { ok: true } : { ok: false, out: "omp 프로세스에 답을 보내지 못했습니다" };
}

// 새로 붙은 화면이 대기 질문을 되살릴 수 있게 한다.
function asksFor(node) {
  const m = pending.get(keyOf(node));
  return m ? [...m.values()].map((x) => x.request) : [];
}

function allAsks() {
  const out = [];
  for (const m of pending.values()) for (const x of m.values()) out.push({ node: x.node, request: x.request });
  return out;
}

module.exports = { bind, answer, asksFor, allAsks, drop };
