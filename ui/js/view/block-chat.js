/* omp-live-map · view · chat 블록 (세션 대화 기록 + 에이전트에 프롬프트 전송) */

const CHAT_SHOW = 8;

// 세션 기록의 대화 + 아직 기록에 안 올라온 로컬 표시분. 툴 칩으로 거른 상태면 그 툴을 쓴 턴만.
function chatMsgs(node, st) {
  syncChatLog(node, st);
  const tool = CHAT_TOOL.get(node.id) || "";
  const base = [...(node.messages || []), ...st.log];
  const all = tool ? base.filter((m) => (m.tools || []).includes(tool)) : base;
  return { all, shown: st.expanded ? all : all.slice(-CHAT_SHOW), tool };
}

// 사용자 입력은 원문 개행을 유지하고 fenced code만 별도 스크롤 영역으로 분리한다. 답변은 mdHTML(core/markdown.js)로 그린다.
function chatBodyHTML(text) {
  const src = String(text ?? "");
  const fence = /^```[^\r\n]*\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gm;
  let html = "", from = 0, match;
  while ((match = fence.exec(src))) {
    html += `<span class="ctxt">${esc(src.slice(from, match.index))}</span><pre><code>${esc(match[1].replace(/\r?\n$/, ""))}</code></pre>`;
    from = fence.lastIndex;
  }
  return html + `<span class="ctxt">${esc(src.slice(from))}</span>`;
}

// 시각 문구(ago)는 매 초 바뀌므로 마크업에 넣지 않고 hover 때 채운다.
function chatListHTML(st, shown, tool, act) {
  const html = shown.map((m, i) => {
    const body = chatText(m.text);
    const toolOnly = m.role !== "user" && !body;
    const names = (m.tools || []).join(", ");
    const ts = typeof m.ts === "number" ? m.ts : Date.parse(m.ts || "");
    const cts = ts ? `<span class="cts" data-ts="${ts}" title="${esc(new Date(ts).toLocaleString("ko-KR"))}"></span>` : "";
    const label = toolOnly ? `도구 호출 ${m.n || 1}회${names ? " · " + names : ""}` : body;
    return `<div class="cmsg ${m.role === "user" ? "u" : "a"}"${!toolOnly && names ? ` title="사용 도구: ${esc(names)}"` : ""}>
      <span class="who">${m.role === "user" ? "user" : "ai"}</span><div class="tx${toolOnly ? " dim" : ""}">${m.role === "user" || toolOnly ? chatBodyHTML(label) : mdHTML(label)}</div>
      <span class="cact">${cts}${toolOnly ? "" : `<button class="ccopy" data-copy="${i}">복사</button>`}</span></div>`;
  }).join("");
  // 도는 중인 활동에 답변 글이 있으면 같은 글을 말풍선으로 또 그리지 않는다.
  const stream = st.stream && !act.includes('class="lvitem text"') ? `<div class="cmsg a"><span class="who">ai</span><div class="tx">${mdHTML(st.stream)}</div></div>` : "";
  // 기록 메시지 → 마지막 턴 활동 → 흘러나오는 답변 순서.
  if (html || act || stream) return html + act + stream;
  return `<div class="cmsg"><div class="tx dim">${tool ? "최근 기록에 이 툴을 쓴 턴이 없습니다" : "대화 기록 없음"}</div></div>`;
}

const chatMoreText = (st, all) => (st.expanded ? `최근 ${CHAT_SHOW}개만 보기` : `이전 대화 더 보기 (${all.length - CHAT_SHOW})`);

const chatSumHTML = (st) => esc(st.summary)
  + (st.error ? `<div class="cerr"><span>${esc(st.error)}</span>${st.retry ? '<button data-retry="1">다시 시도</button>' : ""}</div>` : "");

function chatBlock(n) {
  const st = chatState(n.id);
  const { all, shown, tool } = chatMsgs(n, st);
  return `<div class="chat">
    <div class="cfilter"${tool ? "" : " hidden"}><span>${esc(tool)} 사용 턴만 표시 중</span><button data-unfilter="1">해제</button></div>
    <button class="cmore" data-more="1"${all.length > CHAT_SHOW ? "" : " hidden"}>${esc(chatMoreText(st, all))}</button>
    <div class="cmsgs">${chatListHTML(st, shown, tool, chatActivityHTML(n.id, st))}</div>
    <div class="cmnote" hidden></div>
    ${chatModelPickerHTML()}
    <div class="crow">
      <button class="cmodel" data-model="1">${esc(chatModelLabel(n))}</button>
      <textarea class="cin" rows="1" placeholder="에이전트에 프롬프트 전송 (Ctrl+Enter)">${esc(st.draft)}</textarea>
      <button data-send="1">보내기</button>
      <button class="stop" data-cancel="1"${st.busy ? "" : " hidden"}>취소</button>
      <button data-sum="1">요약</button>
      <button data-compact="1"${st.busy || st.compacting ? " disabled" : ""}>${st.compacting ? "압축 중…" : "압축"}</button>
      <button data-clear="1"${st.busy || st.clearing ? " disabled" : ""}>${st.clearing ? "비우는 중…" : "비우기"}</button>
    </div>
    <div class="csum">${chatSumHTML(st)}</div>
  </div>`;
}

// 내용에 맞춰 1~5줄(최대 120px)로 높이를 맞춘다.
function fitChatInput(ta) {
  const cs = getComputedStyle(ta);
  const lh = parseFloat(cs.lineHeight) || 15;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const bd = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const max = Math.min(120, lh * 5 + pad + bd);
  ta.style.height = "auto";
  const want = ta.scrollHeight + bd;
  ta.style.height = Math.max(lh + pad + bd, Math.min(max, want)) + "px";
  ta.style.overflowY = want > max ? "auto" : "hidden";
}

function paintChat(id) {
  const el = ELS.get(id);
  const node = nodeById(id);
  const box = el && el.querySelector(".chat");
  if (!box || !node) return;
  const st = chatState(id);
  const { all, shown, tool } = chatMsgs(node, st);
  const filter = box.querySelector(".cfilter");
  filter.hidden = !tool;
  filter.firstElementChild.textContent = tool + " 사용 턴만 표시 중";
  const more = box.querySelector(".cmore");
  more.hidden = all.length <= CHAT_SHOW;
  more.textContent = chatMoreText(st, all);
  const list = box.querySelector(".cmsgs");
  const html = chatListHTML(st, shown, tool, chatActivityHTML(id, st));
  if (list.__html !== html) {
    // 맨 아래를 보고 있었으면 새 메시지를 따라가고, 위로 올려 둔 위치는 지킨다.
    const wasBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    const top = list.scrollTop;
    list.__html = html;
    list.innerHTML = html;
    list.scrollTop = wasBottom ? list.scrollHeight : top;
  }
  const sum = box.querySelector(".csum");
  const sumHTML = chatSumHTML(st);
  if (sum.__html !== sumHTML) { sum.__html = sumHTML; sum.innerHTML = sumHTML; }
  // 도는 중에도 보내기는 열려 있다(추가 지시). 취소는 도는 동안만 보인다.
  box.querySelector("button[data-cancel]").hidden = !st.busy;
  // 압축·비우기는 진행 중이거나 에이전트가 도는 동안 눌러지지 않는다.
  const compact = box.querySelector("button[data-compact]");
  compact.disabled = !!(st.busy || st.compacting);
  compact.textContent = st.compacting ? "압축 중…" : "압축";
  const clr = box.querySelector("button[data-clear]");
  clr.disabled = !!(st.busy || st.clearing);
  clr.textContent = st.clearing ? "비우는 중…" : "비우기";
  // 입력 중에는 input 리스너가 draft 를 맞춰 두므로, 값이 다르면 전송·실패 복원 같은 프로그램 변경이다.
  const ta = box.querySelector(".cin");
  if (ta.value !== st.draft) { ta.value = st.draft; fitChatInput(ta); }
  paintChatModel(box, node, st);
}

function mountChat(blk, n) {
  const id = n.id;
  const box = blk.querySelector(".chat");
  const st = chatState(id);
  const ta = box.querySelector(".cin");
  fitChatInput(ta);
  ta.addEventListener("input", () => { st.draft = ta.value; fitChatInput(ta); });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(id); }
  });
  box.addEventListener("click", (e) => {
    // 활동 묶음: 툴 출력 펼침과 끝난 턴 요약 행 접기·펼치기.
    const pre = e.target.closest("pre[data-lvout].more");
    if (pre) {
      // 출력 글을 끌어서 고르는 중이면 펼침을 바꾸지 않는다.
      if (String(getSelection()) !== "") return;
      const it = liveItems(id).find((x) => String(x.seq) === pre.dataset.lvout);
      if (it) { it.open = !it.open; paintChat(id); }
      return;
    }
    if (e.target.closest("[data-actsum]")) { st.actOpen = !st.actOpen; paintChat(id); return; }
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.send) sendChat(id);
    else if (b.dataset.model) toggleModelPicker(id);
    else if (b.dataset.pickId) { if (!modelPick(id).loading) pickModel(id, b.dataset.pickP, b.dataset.pickId); }
    else if (b.dataset.cancel) cancelChat(id);
    else if (b.dataset.sum) summarize(id);
    else if (b.dataset.compact) compactChat(id);
    else if (b.dataset.clear) clearChat(id);
    else if (b.dataset.retry) retryChat(id);
    else if (b.dataset.more) { st.expanded = !st.expanded; paintChat(id); }
    else if (b.dataset.unfilter) toggleChatTool(id, CHAT_TOOL.get(id));
    else if (b.dataset.copy != null) {
      const node = nodeById(id);
      const m = node && chatMsgs(node, st).shown[+b.dataset.copy];
      if (m) copyText(m.text, b);
    }
  });
  box.addEventListener("mouseover", (e) => {
    const row = e.target.closest(".cmsg");
    const cts = row && row.querySelector(".cts");
    if (cts) cts.textContent = ago(+cts.dataset.ts);
  });
  const list = box.querySelector(".cmsgs");
  list.scrollTop = list.scrollHeight;
  mountChatModel(box, id);
  paintChatModel(box, n, st);
}

registerBlock({ type: "chat", slot: "main", flex: 7.4, render: chatBlock, mount: mountChat, paint: (box, n) => paintChat(n.id) });
