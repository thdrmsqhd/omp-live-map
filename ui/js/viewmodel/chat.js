/* omp-live-map · viewmodel · 에이전트 프롬프트 전송·취소·요약 */

// 도구 호출만 한 턴은 본문이 비어 있거나 "." 하나다.
const chatText = (t) => {
  const raw = String(t ?? "");
  return /^[.·,\s]*$/.test(raw.trim()) ? "" : raw;
};

// st.log 는 세션 기록에 아직 안 올라온 로컬 표시분이다. 기록이 따라오면 지운다.
function syncChatLog(node, st) {
  const msgs = node.messages || [];
  st.log = st.log.filter((e) => !msgs.some((m) => m.role === e.role && (m.ts || 0) >= e.since - 1500
    && (m.role === "user" || chatText(m.text))));
}

// 흘러나오던 답변을 대화에 확정한다. 추가 지시가 끼어들면 그 앞까지가 한 덩어리다.
function commitStream(st, fallback) {
  const final = (st.stream || fallback || "").trim();
  if (final) st.log.push({ role: "assistant", text: final.slice(-1500), ts: Date.now(), since: st.since || 0 });
  st.stream = "";
}

// 서버는 받자마자 ok 를 돌려준다. 답변 확정과 busy 해제는 SSE done(handleChatEvent)이 맡는다. 도는 중이면 추가 지시로 간다.
async function sendChat(id) {
  const st = chatState(id);
  const text = (st.draft || "").trim();
  if (!text) return;
  commitStream(st);
  const since = Date.now();
  const entry = { role: "user", text, ts: since, since };
  // 모델 변경 안내는 새 턴이 시작되면 끝난 이야기다(도는 중 추가 지시는 같은 턴).
  if (!st.busy) st.modelNote = "";
  Object.assign(st, { busy: true, draft: "", error: "", retry: "", lastText: text, since });
  st.log.push(entry);
  paintChat(id);
  let out = {};
  try {
    const res = await postJSON("/api/prompt", { node: id, text });
    out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) {
    out = { ok: false, out: err.message };
  }
  if (out.ok) return;
  // 전달되지 않은 입력은 대화 목록에서 빼고 입력창에 되돌려 다시 시도할 수 있게 한다.
  const i = st.log.indexOf(entry);
  if (i >= 0) st.log.splice(i, 1);
  if (!st.draft) st.draft = text;
  st.busy = false;
  st.error = "전송 실패: " + (out.out || "응답 없음");
  st.retry = "send";
  paintChat(id);
}

async function cancelChat(id) {
  const st = chatState(id);
  try {
    const res = await postJSON("/api/prompt/cancel", { node: id });
    const out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
    // 서버에 실행 중인 프롬프트가 없으면(다른 탭에서 보낸 것이 이미 끝남 등) 전송 중 표시를 푼다.
    if (!out.ok) { st.busy = false; st.error = "취소 실패: " + (out.out || "응답 없음"); }
  } catch (err) {
    st.error = "취소 실패: " + err.message;
  }
  paintChat(id);
}

async function summarize(id) {
  const st = chatState(id);
  st.summary = "요약 생성 중…";
  st.error = "";
  paintChat(id);
  let fail = "";
  try {
    const res = await postJSON("/api/summary", { node: id });
    const out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
    if (res.ok && out.ok) st.summary = out.out;
    else fail = "요약 실패: " + (out.out || out.code || "HTTP " + res.status);
  } catch (err) {
    fail = "요약 실패: " + err.message;
  }
  if (fail) { st.summary = ""; st.error = fail; st.retry = "sum"; }
  paintChat(id);
}

// 컨텍스트 압축: 작업 가이드 없이 omp 의 compact 만 부른다. 결과는 요약 줄(.csum)에 남긴다.
async function compactChat(id) {
  const st = chatState(id);
  if (st.compacting || st.busy) return;
  st.compacting = true;
  st.summary = "";
  st.error = "";
  st.retry = "";
  paintChat(id);
  let out = {};
  try {
    const res = await postJSON("/api/context", { node: id, mode: "compact" });
    out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) {
    out = { ok: false, out: err.message };
  }
  st.compacting = false;
  if (out.ok) st.summary = out.out || "압축했습니다";
  else st.error = "압축 실패: " + (out.out || "응답 없음");
  paintChat(id);
}

// 비우기: omp 의 new_session 으로 컨텍스트 없는 새 세션을 연다. 맵은 세션 파일 경로로 카드를 추적하므로
// 새 node 로 열린 카드·자리를 넘기고, 새 기록이 스냅샷에 들어올 때까지 그래프를 다시 받는다.
async function clearChat(id) {
  const st = chatState(id);
  if (st.clearing || st.busy) return;
  if (!confirm("대화 컨텍스트를 비우고 새 세션으로 이어갑니다")) return;
  st.clearing = true;
  st.summary = "";
  st.error = "";
  st.retry = "";
  paintChat(id);
  let out = {};
  try {
    const res = await postJSON("/api/context", { node: id, mode: "clear" });
    out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) {
    out = { ok: false, out: err.message };
  }
  st.clearing = false;
  if (!out.ok) {
    st.error = (out.cancelled ? "비우기 취소: " : "비우기 실패: ") + (out.out || "응답 없음");
    paintChat(id);
    return;
  }
  adoptOpenCard(id, out.node);
  let found = false;
  for (let i = 0; i < 10 && !found; i++) {
    await reloadGraph();
    found = DATA.sessions.some((s) => (s.nodes || []).some((n) => n.id === out.node));
    if (!found) await new Promise((done) => setTimeout(done, 300));
  }
  // 새 기록이 아직 스냅샷에 없으면 없는 노드를 열어 둘 수 없으므로 카드를 접고 알린다.
  if (!found) {
    closeCard(out.node);
    alert("새 세션 기록을 찾지 못했습니다: " + out.node);
  }
  renderMap(false, true);
}

// 오류 줄의 "다시 시도": 마지막 전송 입력 또는 요약을 그대로 다시 요청한다.
function retryChat(id) {
  const st = chatState(id);
  const kind = st.retry;
  st.error = "";
  st.retry = "";
  if (kind === "sum") summarize(id);
  else if (kind === "send") { st.draft = st.lastText || st.draft; sendChat(id); }
  else paintChat(id);
}

// SSE chat 이벤트. 보낸 탭은 sendChat 이 입력을 이미 기록했으므로 다른 탭에서 보낸 것만 여기서 기록한다.
function handleChatEvent(c) {
  const st = chatState(c.node);
  if (c.kind === "req") {
    const last = st.log[st.log.length - 1];
    const mine = st.busy && last && last.role === "user" && last.text === c.text;
    if (!mine) {
      commitStream(st);
      st.since = Date.now();
      st.log.push({ role: "user", text: c.text, ts: st.since, since: st.since });
    }
    st.busy = true;
  } else if (c.kind === "delta") {
    // 추가 지시 전송이 실패해 busy 가 풀렸어도 돌던 턴의 글이 오면 다시 도는 중으로 본다.
    st.busy = true;
    st.stream += c.text;
  } else if (c.kind === "done") {
    commitStream(st, c.text);
    st.busy = false;
    if (c.cancelled) { st.error = "응답 생성을 취소했습니다"; st.retry = "send"; }
    else if (c.code) st.error = `omp 가 코드 ${c.code}로 끝났습니다`;
  }
  if (st.log.length > 8) st.log = st.log.slice(-8);
  if (openIds.has(c.node)) paintChat(c.node);
}

// 툴 칩을 누르면 대화를 그 툴을 쓴 턴으로 거른다. 같은 칩을 다시 누르면 푼다.
function toggleChatTool(id, tool) {
  if (CHAT_TOOL.get(id) === tool) CHAT_TOOL.delete(id); else CHAT_TOOL.set(id, tool);
  renderMap(false, true);
}
