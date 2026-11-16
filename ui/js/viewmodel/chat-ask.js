/* omp-live-map · viewmodel · 에이전트가 묻는 질문(확장 UI 요청)의 상태·답 전송 */

// node 키 -> 대기 요청 배열. 요청마다 화면이 고른 답 상태(_sel·_custom·_value)를 함께 둔다.
const ASKS = new Map();
const askKey = (node) => String(node ?? "").replace(/\\/g, "/").toLowerCase();

function asksOf(node) {
  return ASKS.get(askKey(node)) || [];
}

const askPending = (node) => asksOf(node).length > 0;

// 요청에 답 상태를 붙인다. 다시 그려도 사용자가 고른 값이 남는다.
function askPrep(r) {
  if (r.method === "ask") {
    for (const q of r.questions || []) { q._sel = new Set(); q._custom = ""; }
  } else if (r.method === "select") {
    const init = r.selectionMarker === "radio" ? [Number(r.initialIndex) || 0] : (r.checkedIndices || []);
    r._sel = new Set(init.filter((i) => i >= 0 && i < r.options.length));
  } else if (r.method === "input" || r.method === "editor") {
    r._value = r.method === "editor" ? r.prefill || "" : "";
  }
  r._err = "";
  return r;
}

// 카드에 걸린 질문이 바뀌면 그 카드와 대화 블록을 다시 그린다.
function askTouched(node) {
  const id = liveNodeId(node) || node;
  if (ELS.has(id) && openIds.has(id) && typeof paintChat === "function") paintChat(id);
  renderMap(false);
}

// SSE ask 이벤트: add(질문 등장) / del(답을 보냈거나 취소·시한 초과로 해소).
function handleAskEvent(a) {
  if (!a || !a.node) return;
  const key = askKey(a.node);
  const list = ASKS.get(key) || [];
  if (a.kind === "del") {
    const i = list.findIndex((r) => r.id === String(a.id));
    if (i < 0) return;
    list.splice(i, 1);
  } else if (a.kind === "add" && a.request && a.request.id) {
    if (list.some((r) => r.id === a.request.id)) return;
    list.push(askPrep(a.request));
  } else return;
  if (list.length) ASKS.set(key, list); else ASKS.delete(key);
  askTouched(a.node);
}

function askFind(node, id) {
  return asksOf(node).find((r) => r.id === String(id)) || null;
}

// 고른 답: 라디오는 하나, 체크박스는 여럿(다시 누르면 해제).
function askPick(node, id, qi, label) {
  const r = askFind(node, id);
  const q = r && r.questions && r.questions[qi];
  if (!q) return;
  if (q.multi) { if (q._sel.has(label)) q._sel.delete(label); else q._sel.add(label); }
  else { q._sel = new Set([label]); q._custom = ""; }
  q._err = "";
  paintChat(liveNodeId(node) || node);
}

function askCustom(node, id, qi, value) {
  const r = askFind(node, id);
  const q = r && r.questions && r.questions[qi];
  if (q) { q._custom = value; if (value) q._sel = new Set(); }
}

function askSelect(node, id, idx) {
  const r = askFind(node, id);
  if (!r || r.method !== "select") return;
  if (r.selectionMarker === "checkbox") {
    if (r._sel.has(idx)) r._sel.delete(idx); else r._sel.add(idx);
  } else r._sel = new Set([idx]);
  r._err = "";
  paintChat(liveNodeId(node) || node);
}

function askValue(node, id, value) {
  const r = askFind(node, id);
  if (r) r._value = value;
}

// 지금 상태로 보낼 답. 답이 모자라면 { error }.
function askResponse(r) {
  if (r.method === "ask") {
    const answers = [];
    for (const q of r.questions || []) {
      const custom = String(q._custom || "").trim();
      const selected = [...q._sel];
      if (!selected.length && !custom) return { error: "모든 질문에 답을 골라 주세요" };
      answers.push({ id: q.id, selectedOptions: selected, ...(custom ? { customInput: custom } : {}) });
    }
    return { response: { answers } };
  }
  if (r.method === "select") {
    const labels = [...r._sel].sort((a, b) => a - b).map((i) => r.options[i]);
    if (!labels.length) return { error: "항목을 골라 주세요" };
    return { response: { value: labels.join(", ") } };
  }
  if (r.method === "confirm") return { response: { confirmed: true } };
  return { response: { value: String(r._value || "") } };
}

async function askPost(node, id, response) {
  const r = askFind(node, id);
  if (r) r._err = "";
  let out = {};
  try {
    const res = await postJSON("/api/chat/answer", { node, id, response });
    out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) {
    out = { ok: false, out: err.message };
  }
  if (!out.ok) {
    const cur = askFind(node, id);
    if (cur) { cur._err = out.out || "답을 보내지 못했습니다"; paintChat(liveNodeId(node) || node); }
  }
  return out;
}

// 확인(confirm) 카드는 참/거짓을 바로 보낸다.
function askConfirm(node, id, yes) {
  return askPost(node, id, { confirmed: !!yes });
}

function askSend(node, id) {
  const r = askFind(node, id);
  if (!r || r._sending) return;
  const made = askResponse(r);
  if (made.error) { r._err = made.error; paintChat(liveNodeId(node) || node); return; }
  r._sending = true;
  askPost(node, id, made.response).finally(() => { r._sending = false; });
}

// 카드의 X·취소: 이 질문을 닫는다. 이후 그 질문의 답은 omp 가 무시한다.
function askCancel(node, id) {
  return askPost(node, id, { cancelled: true });
}
