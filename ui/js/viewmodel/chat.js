/* omp-live-map · viewmodel · 에이전트 프롬프트 전송·취소·요약 */

// 도구 호출만 한 턴은 본문이 비어 있거나 "." 하나다.
const chatText = (t) => {
  const raw = String(t ?? "");
  return /^[.·,\s]*$/.test(raw.trim()) ? "" : raw;
};

// blob 미리보기: 기록 메시지 ts -> URL 목록. 스냅샷이 이미지 실린 메시지를 매번 새 객체로 만들므로
// 객체가 아니라 ts 로 둔다. 로컬 표시분이 기록 메시지로 바뀌어도 화면에서 미리보기가 바로 사라지지 않는다.
function revokePreviews(list) {
  for (const url of list || []) URL.revokeObjectURL(url);
}

// 기록에서 사라졌거나 images(URL·base64)로 대체된 미리보기는 해제한다. 스냅샷이 잠깐 비는 동안
// 아직 그릴 수 있는 미리보기를 잃지 않도록 최근 것은 조금 더 들고 있는다.
function prunePreviews(st, msgs) {
  const map = st.previews;
  if (!map || !map.size) return;
  const now = Date.now();
  const alive = new Set(msgs.filter((m) => !(m.images && m.images.length)).map((m) => m.ts));
  const replaced = new Set(msgs.filter((m) => m.images && m.images.length).map((m) => m.ts));
  for (const [ts, urls] of map) {
    if (alive.has(ts)) continue;
    if (!replaced.has(ts) && now - ts < 120_000) continue;
    revokePreviews(urls);
    map.delete(ts);
  }
}

// 기록 메시지 ts 에 넘겨 둔 blob 미리보기. 없으면 null.
const chatPreviews = (st, ts) => (st.previews && ts ? st.previews.get(ts) || null : null);

// st.log 는 세션 기록에 아직 안 올라온 로컬 표시분이다. 기록이 따라오면 지운다.
function syncChatLog(node, st) {
  const msgs = node.messages || [];
  const used = new Set();
  prunePreviews(st, msgs);
  st.log = st.log.filter((e) => {
    const hit = msgs.find((m) => !used.has(m) && m.role === e.role && (m.ts || 0) >= e.since - 1500
      && (e.id&&m.id?e.id===m.id:String(m.text||"").trim()===String(e.text||"").trim()));
    if (!hit) return true;
    used.add(hit);
    // 기록 메시지가 images 를 실었으면 blob 미리보기는 필요 없다. 아니면 ts 로 넘겨 계속 그린다.
    if (e.previews && e.previews.length) {
      const ts = typeof hit.ts === "number" ? hit.ts : Date.parse(hit.ts || "");
      if ((hit.images && hit.images.length) || !ts) revokePreviews(e.previews);
      else {
        st.previews = st.previews || new Map();
        const prev = st.previews.get(ts);
        if (prev && prev !== e.previews) revokePreviews(prev);
        st.previews.set(ts, e.previews);
      }
    }
    e.previews = null;
    return false;
  });
}

// 흘러나오던 답변을 대화에 확정한다. 추가 지시가 끼어들면 그 앞까지가 한 덩어리다.
function commitStream(st, fallback) {
  const final = (st.stream || fallback || "").trim();
  if (final) st.log.push({ role: "assistant", text: final.slice(0,1000000), ts: Date.now(), since: st.since || 0 });
  st.stream = "";
}

// 서버는 받자마자 ok 를 돌려준다. 답변 확정과 busy 해제는 SSE done(handleChatEvent)이 맡는다. 도는 중이면 추가 지시로 간다.
// 첨부(st.files)는 함께 보내고, 실패하면 입력창 아래로 되돌린다.
async function sendChat(id,entryOverride=null) {
  const st = chatState(id);
  if(st.sending||!promptConnected()||askPending(id))return false;
  const text = (entryOverride?.text ?? st.draft ?? "").trim();
  const files = entryOverride?.files || st.files;
  const priorBusy=st.busy;
  if (!text && !files.length) return false;
  const bad = attachProblem(files);
  if (bad) { st.error = bad; st.retry = ""; viewUpdates.chat?.(id); return false; }
  if(typeof attnClear==="function")attnClear(id);
  st.sending=true;
  st.historyOffset=0;st.search="";
  const search=ELS.get(id)?.querySelector(".chat-search");if(search)search.value="";
  commitStream(st);
  const since = Date.now();
  // 사용자가 붙인 이미지는 보내는 즉시 말풍선에 그린다. 서버 기록이 올라오기 전까지는 blob 미리보기를,
  // 기록이 따라오면 images(지연 URL·base64) 또는 넘겨받은 미리보기를 그린다.
  const images = attachImages(files);
  const previews = files.filter((it) => it.url && !it.err && IMAGE_MIMES.has(it.mime) && it.data).map((it) => it.url);
  // 첨부가 있으면 서버가 저장 경로를 붙인 글을 SSE req 로 돌려주므로(handleChatEvent) 그때 바꿔 단다.
  const entry = { role: "user", text: text || "(첨부 " + files.map((f) => f.name).join(", ") + ")", ts: since, since,
    attach: files.length > 0, images, previews };
  // 모델 변경 안내는 새 턴이 시작되면 끝난 이야기다(도는 중 추가 지시는 같은 턴).
  if (!st.busy) st.modelNote = "";
  Object.assign(st, { busy: true, error: "", retry: "", lastText: text, since });
  if(!entryOverride){st.draft="";st.files=[];}
  st.log.push(entry);
  viewUpdates.chat?.(id);
  let out = {};
  try {
    const res = await postJSON("/api/prompt", { node: id, text, files: attachPayload(files) });
    out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) {
    out = { ok: false, out: err.message };
  }
  st.sending=false;
  if (out.ok) { clearAttachments(files, new Set(previews)); rememberPrompt(id,text);persistPromptDraft(id,st);viewUpdates.chat?.(id); return true; }
  // 전달되지 않은 입력은 대화 목록에서 빼고 입력창에 되돌려 다시 시도할 수 있게 한다.
  const i = st.log.indexOf(entry);
  if (i >= 0) st.log.splice(i, 1);
  if(!entryOverride){st.draft=st.draft?text+"\n\n"+st.draft:text;st.files=files.concat(st.files);}
  st.busy = priorBusy;
  st.error = "전송 실패: " + (out.out || "응답 없음");
  st.retry = entryOverride?"":"send";
  persistPromptDraft(id,st);viewUpdates.chat?.(id);return false;
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
  viewUpdates.chat?.(id);
}

async function summarize(id) {
  const st = chatState(id);
  st.summary = "요약 생성 중…";
  st.error = "";
  viewUpdates.chat?.(id);
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
  viewUpdates.chat?.(id);
}

// 컨텍스트 압축: 작업 가이드 없이 omp 의 compact 만 부른다. 결과는 요약 줄(.csum)에 남긴다.
async function compactChat(id) {
  const st = chatState(id);
  if (st.compacting || st.busy) return;
  st.compacting = true;
  st.summary = "";
  st.error = "";
  st.retry = "";
  viewUpdates.chat?.(id);
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
  viewUpdates.chat?.(id);
}

// 비우기: omp 가 새 세션 파일로 이어 가도 카드 id·자리·이름·메모는 그대로 두고 대화만 빈다.
// 서버가 계보로 카드 id 를 고정하므로 이 카드의 화면 상태만 버리고 새 기록을 다시 받는다.
async function clearChat(id) {
  const st = chatState(id);
  if (st.clearing || st.busy) return;
  if (!confirm("지금까지 대화 기억을 비울까요? 카드와 메모는 그대로 남습니다")) return;
  st.clearing = true;
  st.summary = "";
  st.error = "";
  st.retry = "";
  viewUpdates.chat?.(id);
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
    viewUpdates.chat?.(id);
    return;
  }
  CHAT.delete(id);        // 비우기 전 로컬 표시분·요약을 버린다
  CTX.delete(id);         // 컨텍스트 블록 캐시도 새 기록 기준으로 다시 읽는다
  CHAT_TOOL.delete(id);
  await reloadGraph();
  viewUpdates.map?.(false, true);
  viewUpdates.chat?.(id);
}

// 오류 줄의 "다시 시도": 마지막 전송 입력 또는 요약을 그대로 다시 요청한다.
function retryChat(id) {
  const st = chatState(id);
  const kind = st.retry;
  st.error = "";
  st.retry = "";
  if (kind === "sum") summarize(id);
  else if (kind === "send") { if(!st.draft)st.draft=st.lastText||"";persistPromptDraft(id,st);submitPrompt(id); }
  else viewUpdates.chat?.(id);
}

// SSE chat 이벤트. 보낸 탭은 sendChat 이 입력을 이미 기록했으므로 다른 탭에서 보낸 것만 여기서 기록한다.
function handleChatEvent(c) {
  const st = chatState(c.node);
  if(c.turnId&&c.kind==="req"){if(st.turnId===c.turnId)return;st.turnId=c.turnId;}
  if (c.kind === "req") {
    const last = st.log[st.log.length - 1];
    const mine = st.busy && last && last.role === "user" && (last.text === c.text || last.attach);
    if (mine && last.attach) {
      last.text = c.text;
      last.attach = false;
      if (Array.isArray(c.images) && c.images.length) last.images = c.images;
    }
    if (!mine) {
      commitStream(st);
      st.since = Date.now();
      st.log.push({ role: "user", text: c.text, ts: st.since, since: st.since });
    }
    st.busy = true;
  } else if (c.kind === "delta") {
    // 추가 지시 전송이 실패해 busy 가 풀렸어도 돌던 턴의 글이 오면 다시 도는 중으로 본다.
    st.busy = true;
    st.stream = (st.stream + String(c.text||"")).slice(0,1000000);
  } else if (c.kind === "done") {
    if(c.turnId&&st.lastDone===c.turnId)return;st.lastDone=c.turnId;
    commitStream(st, c.text);
    st.busy = false;
    queuePromptDone(c.node,!c.cancelled&&!c.code);
    if(typeof refreshClaudeQueue==="function"&&nodeById(c.node)&&capsOf(nodeById(c.node)).id==="claude")setTimeout(()=>void refreshClaudeQueue(c.node),500);
    if (c.cancelled) { st.error = "응답 생성을 취소했습니다"; st.retry = "send"; }
    else if (c.code) {
      const n = nodeById(c.node);
      st.error = `${n ? harnessLabel(n) : "에이전트"}가 코드 ${c.code}로 끝났습니다`+(c.error?" · "+c.error:"");
    }
  }
  // 기록으로 옮겨간 미리보기를 먼저 넘기고, 화면에 남지 않게 밀려난 항목의 미리보기는 해제한다.
  const node = nodeById(c.node);
  if (node) syncChatLog(node, st);
  if (st.log.length > 8) {
    for (const e of st.log.slice(0, -8)) if (e.previews) revokePreviews(e.previews);
    st.log = st.log.slice(-8);
  }
  if (openIds.has(c.node)) liveTouch(c.node);
}

// 툴 칩을 누르면 대화를 그 툴을 쓴 턴으로 거른다. 같은 칩을 다시 누르면 푼다.
function toggleChatTool(id, tool) {
  if (CHAT_TOOL.get(id) === tool) CHAT_TOOL.delete(id); else CHAT_TOOL.set(id, tool);
  viewUpdates.map?.(false, true);
}
