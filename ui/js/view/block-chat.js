/* omp-live-map · view · chat 블록 (세션 대화 기록 + 에이전트에 프롬프트 전송) */

const CHAT_SHOW = 24, CHAT_PAGE = 40;
const CHAT_SELECTION_PENDING = new Set();
function chatViewPrefs(id){const p=readJSON("omp-map-chat-view:"+id,{});return {font:Math.max(12,Math.min(18,Number(p?.font)||14))};}
function patchChatRows(host,html){const t=document.createElement("template");t.innerHTML=html;const old=new Map([...host.children].filter(x=>x.dataset.chatKey).map(x=>[x.dataset.chatKey,x]));let cursor=host.firstElementChild;for(const fresh of [...t.content.children]){let node=fresh;const prev=old.get(fresh.dataset.chatKey);if(prev){old.delete(fresh.dataset.chatKey);if(prev.__source===fresh.outerHTML||prev.outerHTML===fresh.outerHTML)node=prev;else if(fresh.dataset.chatKey==="stream"){const tx=prev.querySelector(".tx"),next=fresh.querySelector(".tx");if(tx&&next){tx.innerHTML=next.innerHTML;node=prev;}}}node.__source=fresh.outerHTML;if(node!==cursor)host.insertBefore(node,cursor);cursor=node.nextElementSibling;}while(cursor){const next=cursor.nextElementSibling;cursor.remove();cursor=next;}for(const pre of host.querySelectorAll(".cmsg pre")){if(pre.parentElement.classList.contains("chat-code"))continue;const wrap=document.createElement("div");wrap.className="chat-code";const bar=document.createElement("header");const lang=document.createElement("span");lang.textContent=pre.querySelector("code")?.dataset.lang||"code";const btn=document.createElement("button");btn.dataset.codeCopy="1";btn.textContent="코드 복사";bar.append(lang,btn);pre.before(wrap);wrap.append(bar,pre);}}


// 세션 기록의 대화 + 아직 기록에 안 올라온 로컬 표시분. 툴 칩으로 거른 상태면 그 툴을 쓴 턴만.
function chatMsgs(node, st) {
  syncChatLog(node, st);
  const tool = CHAT_TOOL.get(node.id) || "";
  const base = [...(node.messages || []), ...st.log];
  const query=String(st.search||"").trim().toLowerCase();
  const all = base.filter(m=>(!tool||(m.tools||[]).includes(tool))&&(!query||String(m.text||"").toLowerCase().includes(query)));
  const offset = Math.min(Math.max(0, Number(st.historyOffset)||0), Math.max(0, all.length-1));
  const end = all.length-offset, start = Math.max(0,end-(offset?CHAT_PAGE:CHAT_SHOW));
  return { all, shown: all.slice(start,end), tool, start, end, offset };
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
function chatListHTML(st, shown, tool, act, agent="에이전트") {
  const html = shown.map((m, i) => {
    if (m.role === "result") return agentResultHTML(st, m);
    const body = chatText(m.text);
    const toolOnly = m.role !== "user" && !body;
    const names = (m.tools || []).join(", ");
    const ts = typeof m.ts === "number" ? m.ts : Date.parse(m.ts || "");
    const cts = ts ? `<time class="cts" data-ts="${ts}" title="${esc(new Date(ts).toLocaleString("ko-KR"))}">${esc(new Date(ts).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false}))}</time>` : "";
    const label = toolOnly ? `도구 호출 ${m.n || 1}회${names ? " · " + names : ""}` : body;
    const imgs = m.role === "user" ? chatImagesHTML(m, m.previews || chatPreviews(st, ts)) : "";
    // 이미지를 실은 턴의 "(이미지 첨부)" 자리 표시 글은 같은 그림이 이미 있어 숨긴다.
    const text = imgs && /^\(이미지 첨부\)$/.test(label) ? "" : label;
    return `<div data-chat-key="${esc(String(m.id||m.uuid||[m.role,m.ts||m.since||0,i].join(":")))}" class="cmsg ${m.role === "user" ? "u" : "a"}"${!toolOnly && names ? ` title="사용 도구: ${esc(names)}"` : ""}>
      <header class="cmsg-head"><span class="who">${m.role === "user" ? "나" : toolOnly ? "도구 실행" : esc(agent)}</span><span class="cact">${cts}${toolOnly ? "" : `${m.role==="user"?`<button data-chat-reuse="${i}" title="입력창에서 다시 사용">재사용</button>`:""}<button class="ccopy" data-copy="${i}" aria-label="메시지 복사">복사</button>`}</span></header><div class="tx${toolOnly ? " dim" : ""}">${imgs}${m.role === "user" || toolOnly ? chatBodyHTML(text) : mdHTML(label, true)}${agentCallsHTML(st, m)}</div></div>`;
  }).join("");
  // 도는 중인 활동에 답변 글이 있으면 같은 글을 말풍선으로 또 그리지 않는다.
  const stream = st.stream ? `<div class="cmsg a streaming" data-chat-key="stream"><header class="cmsg-head"><span class="who">${esc(agent)}</span><span class="stream-label">응답 생성 중</span></header><div class="tx">${mdHTML(st.stream, true)}</div></div>` : "";
  // 기록 메시지 → 마지막 턴 활동 → 흘러나오는 답변 순서.
  if (html || act || stream) return html + act + stream;
  return `<div class="cmsg"><div class="tx dim">${st.search ? "검색 결과 없음" : tool ? "최근 기록에 이 툴을 쓴 턴이 없습니다" : "대화를 시작하세요"}</div></div>`;
}

const chatPageLabel = (page) => page.all.length ? `${page.start+1}–${page.end} / ${page.all.length}` : "0 / 0";
const chatMoreText = (page) => `이전 대화 (${page.start}개 남음)`;

const chatSumHTML = (st) => esc(st.summary)
  + (st.error ? `<div class="cerr"><span>${esc(st.error)}</span>${st.retry ? '<button data-retry="1">다시 시도</button>' : ""}</div>` : "");

function chatBlock(n) {
  const st = chatState(n.id);
  const caps = capsOf(n);
  const page = chatMsgs(n, st);
  const { all, shown, tool } = page;
  const agent=harnessLabel(n);const prefs=chatViewPrefs(n.id);
  const ro = typeof dockReadOnly === "function" && dockReadOnly(n.id);
  return `<div class="chat${ro ? " ro" : ""}">
    ${ro ? '<div class="rodock">메인 카드에 연결된 서브에이전트 — 대화는 읽기 전용입니다</div>' : ""}
    <div class="cfilter"${tool ? "" : " hidden"}><span>${esc(tool)} 사용 턴만 표시 중</span><button data-unfilter="1">해제</button></div>
    <div class="chat-headbar"><strong>세션 대화</strong><span class="chat-status" role="status"></span><span class="chat-head-spacer"></span><button data-chat-search-toggle="1" aria-label="대화 검색" aria-expanded="${!!st.searchOpen}">검색</button><button data-chat-focus="1" aria-pressed="false">집중</button><button data-chat-export="1">내보내기</button><button data-chat-font="1" title="글자 크기 변경">Aa</button></div>
    <div class="chat-searchbar"${st.searchOpen||st.search?"":" hidden"}><input type="search" class="chat-search" aria-label="대화 검색" placeholder="대화 내용 검색" value="${esc(st.search||"")}"><button data-chat-search-clear="1" title="검색 초기화">초기화</button></div>
    <div class="chat-history-nav"${page.offset||st.searchOpen?"":" hidden"}><button class="cmore" data-more="1"${page.start>0?"":" disabled"}>${esc(chatMoreText(page))}</button><span class="chat-page-label">${esc(chatPageLabel(page))}</span><button data-newer="1"${page.offset?"":" disabled"}>다음</button><button data-latest="1"${page.offset?"":" disabled"}>최신</button></div>
    <div class="cmsgs" style="--chat-font:${prefs.font}px">${chatListHTML(st, shown, tool, page.offset||st.search||tool?"":chatActivityHTML(n.id, st),agent)}</div>
    <button class="chat-jump" data-chat-jump="1" hidden>↓ 최신 응답 보기</button>
    <div class="casks"></div>
    <div class="cworking" role="status" aria-live="polite"${st.busy || actItems(n.id).running ? "" : " hidden"}><span class="cworking-dot" aria-hidden="true"></span>응답 생성·작업 중</div>
    <div class="cmnote" hidden></div>
    ${chatModelPickerHTML()}
    <div class="chat-composer">${promptToolbarHTML(n,st)}<div class="crow"><textarea class="cin" rows="4" placeholder="작업 지시를 입력하세요 · @파일 · /명령 · #Task">${esc(st.draft)}</textarea></div><div class="prompt-preview" hidden></div><div class="prompt-suggestions" hidden></div><div class="achips">${attachChipsHTML(st.files)}</div><div class="chat-compose-actions">
      <button class="cmodel" data-model="1"${caps.model ? "" : ` disabled title="Claude Code는 대화 중 모델 변경을 지원하지 않습니다"`}>${esc(chatModelLabel(n))}</button>
      <button data-chat-attach="1" title="파일 첨부" aria-label="파일 첨부">＋ 첨부</button><input class="chat-file" type="file" multiple hidden>
      <select class="prompt-mode" aria-label="전송 방식"><option value="steer">즉시 지시</option><option value="queue">완료 후 실행</option></select><span class="chat-compose-spacer"></span><details class="chat-extra"><summary>대화 관리</summary><div><button data-sum="1">요약</button>
      <button data-compact="1"${caps.compact ? "" : ` disabled title="Claude Code는 컨텍스트 압축을 지원하지 않습니다"`}>${st.compacting ? "압축 중…" : "압축"}</button>
      <button data-clear="1"${caps.clear ? "" : ` disabled title="Claude Code는 대화 비우기를 지원하지 않습니다"`}>${st.clearing ? "비우는 중…" : "비우기"}</button></div></details><button class="stop" data-cancel="1"${st.busy ? "" : " hidden"}>중단</button><button class="chat-send" data-send="1">보내기 ↑</button></div><div class="chat-hint"></div><div class="prompt-queue" hidden></div></div>
    <div class="csum">${chatSumHTML(st)}</div>
  </div>`;
}

// 내용에 맞춰 1~5줄(최대 120px)로 높이를 맞춘다.
function fitChatInput(ta) {
  const cs = getComputedStyle(ta);
  const lh = parseFloat(cs.lineHeight) || 15;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const bd = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const st=chatState(ta.closest(".node").dataset.id);
  const min=lh*4+pad+bd,max=st.expanded?Math.max(min,ta.closest(".chat").clientHeight*.65):Math.max(min,Math.min(260,lh*10+pad+bd));
  ta.style.height = "auto";
  const want = ta.scrollHeight + bd;
  ta.style.height = Math.max(min,Math.min(max,Math.max(want,st.manualHeight||0,st.expanded?max:0))) + "px";
  ta.style.overflowY = want > max ? "auto" : "hidden";
}

function paintChat(id) {
  const el = ELS.get(id);
  const node = nodeById(id);
  const box = el && el.querySelector(".chat");
  if (!box || !node || !cardContentVisible(id)) return;
  const st = chatState(id);
  const page = chatMsgs(node, st);
  const { all, shown, tool } = page;
  const filter = box.querySelector(".cfilter");
  filter.hidden = !tool;
  filter.firstElementChild.textContent = tool + " 사용 턴만 표시 중";
  const more = box.querySelector(".cmore");
  more.disabled = page.start <= 0;
  more.textContent = chatMoreText(page);
  box.querySelector("[data-newer]").disabled = !page.offset;
  box.querySelector("[data-latest]").disabled = !page.offset;
  box.querySelector(".chat-page-label").textContent = chatPageLabel(page);
  const list = box.querySelector(".cmsgs");
  const html = chatListHTML(st, shown, tool, page.offset||st.search||tool?"":chatActivityHTML(id, st),harnessLabel(node));
  box.querySelector(".chat-searchbar").hidden=!(st.searchOpen||st.search);
  box.querySelector(".chat-history-nav").hidden=!(page.offset||st.searchOpen);
  const status=box.querySelector(".chat-status");status.textContent=askPending(id)?"승인·응답 대기":st.sending?"전송 중":st.busy||actItems(id).running?"작업 중":"대기";
  box.querySelector("[data-chat-search-toggle]").setAttribute("aria-expanded",String(!!st.searchOpen));
  const selection = getSelection();
  const selecting = selection && !selection.isCollapsed && list.contains(selection.anchorNode);
  if (list.__html !== html && selecting) CHAT_SELECTION_PENDING.add(id);
  else if (list.__html !== html) {
    CHAT_SELECTION_PENDING.delete(id);
    st.renderedMessages = shown;
    // 맨 아래를 보고 있었으면 새 메시지를 따라가고, 위로 올려 둔 위치는 지킨다.
    const wasBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    const top = list.scrollTop;
    const anchor=[...list.children].find(x=>x.offsetTop+x.offsetHeight>top&&x.dataset.chatKey);const anchorKey=anchor?.dataset.chatKey,delta=anchor?anchor.offsetTop-top:0;
    list.__html = html;
    patchChatRows(list,html);
    const next=anchorKey&&[...list.children].find(x=>x.dataset.chatKey===anchorKey);
    list.scrollTop = wasBottom ? list.scrollHeight : next?next.offsetTop-delta:top;
  }
  const jump=box.querySelector(".chat-jump");jump.hidden=!page.offset&&list.scrollTop+list.clientHeight>=list.scrollHeight-24;
  const send=box.querySelector("[data-send]");send.textContent=st.busy?"추가 지시 ↑":"보내기 ↑";
  send.disabled=!!st.sending||(!String(st.draft||"").trim()&&!st.files.length);
  const sum = box.querySelector(".csum");
  const sumHTML = chatSumHTML(st);
  if (sum.__html !== sumHTML) { sum.__html = sumHTML; sum.innerHTML = sumHTML; }
  paintChatAsk(box, id);
  box.querySelector(".cworking").hidden = !(st.busy || actItems(id).running);
  // 도는 중에도 보내기는 열려 있다(추가 지시). 취소는 도는 동안만 보인다.
  box.querySelector("button[data-cancel]").hidden = !st.busy;
  // 압축·비우기는 진행 중이거나 에이전트가 도는 동안 눌러지지 않는다. Claude Code 는 둘 다 지원하지 않는다.
  const caps = capsOf(node);
  const compact = box.querySelector("button[data-compact]");
  compact.disabled = !caps.compact || !!(st.busy || st.compacting);
  compact.title = caps.compact ? "" : "Claude Code는 컨텍스트 압축을 지원하지 않습니다";
  compact.textContent = st.compacting ? "압축 중…" : "압축";
  const clr = box.querySelector("button[data-clear]");
  clr.disabled = !caps.clear || !!(st.busy || st.clearing);
  clr.title = caps.clear ? "" : "Claude Code는 대화 비우기를 지원하지 않습니다";
  clr.textContent = st.clearing ? "비우는 중…" : "비우기";
  // 입력 중에는 input 리스너가 draft 를 맞춰 두므로, 값이 다르면 전송·실패 복원 같은 프로그램 변경이다.
  const ta = box.querySelector(".cin");
  if (ta.value !== st.draft) { ta.value = st.draft; fitChatInput(ta); }
  paintAttachChips(box.querySelector(".achips"), st.files);
  paintChatModel(box, node, st);
  paintPromptComposer(box,node,st);
}

function mountChat(blk, n) {
  const id = n.id;
  const box = blk.querySelector(".chat");
  const st = chatState(id);
  const ta = box.querySelector(".cin");
  fitChatInput(ta);
  mountPromptComposer(box,n,st);
  const search=box.querySelector(".chat-search");search.addEventListener("input",()=>{st.search=search.value;st.historyOffset=0;paintChat(id);});
  box.querySelector(".chat-file").addEventListener("change",e=>{const dt=new DataTransfer();for(const file of e.target.files)dt.items.add(file);box.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));e.target.value="";});
  wireAttach(box, () => st.files, () => paintChat(id));

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
    if (chatInlineClick(e, st, id)) return;
    const b = e.target.closest("button");
    if (!b) return;
    if(b.dataset.chatSearchToggle){st.searchOpen=!st.searchOpen;if(!st.searchOpen){st.search="";search.value="";st.historyOffset=0;}paintChat(id);if(st.searchOpen)search.focus();}
    else if(b.dataset.chatFocus){const on=box.classList.toggle("chat-focused");b.setAttribute("aria-pressed",String(on));if(on)box.querySelector(".cin").focus();}
    else if(b.dataset.chatFont){const prefs=chatViewPrefs(id);prefs.font=prefs.font>=18?12:prefs.font+2;writeJSON("omp-map-chat-view:"+id,prefs);box.querySelector(".cmsgs").style.setProperty("--chat-font",prefs.font+"px");}
    else if(b.dataset.chatExport){const text=chatMsgs(nodeById(id),st).all.map(m=>"## "+(m.role==="user"?"나":harnessLabel(nodeById(id)))+"\n\n"+(m.text||"")).join("\n\n");const url=URL.createObjectURL(new Blob([text],{type:"text/markdown;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="conversation.md";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    else if(b.dataset.chatReuse!==undefined){const m=st.renderedMessages?.[+b.dataset.chatReuse];if(m&&(!st.draft||confirm("현재 초안을 교체할까요?")))promptInsert(box,st,m.text,true);}
    else if(b.dataset.codeCopy!==undefined){copyText(b.closest(".chat-code")?.querySelector("code")?.textContent||"",b);}
    else if(b.dataset.chatAttach) box.querySelector(".chat-file").click();
    else if (b.dataset.chatSearchClear) {search.value="";st.search="";st.historyOffset=0;paintChat(id);}
    else if (b.dataset.chatJump) {st.historyOffset=0;st.search="";search.value="";if(CHAT_TOOL.has(id))CHAT_TOOL.delete(id);paintChat(id);const l=box.querySelector(".cmsgs");l.scrollTop=l.scrollHeight;box.querySelector(".chat-jump").hidden=true;}
    else if (b.dataset.send) submitPrompt(id);
    else if (b.dataset.model) toggleModelPicker(id);
    else if (b.dataset.pickId) { if (!modelPick(id).loading) pickModel(id, b.dataset.pickP, b.dataset.pickId); }
    else if (b.dataset.cancel) cancelChat(id);
    else if (b.dataset.sum) summarize(id);
    else if (b.dataset.compact) compactChat(id);
    else if (b.dataset.clear) clearChat(id);
    else if (b.dataset.retry) retryChat(id);
    else if (b.dataset.more || b.dataset.newer || b.dataset.latest) {
      const page = chatMsgs(nodeById(id),st);
      if (b.dataset.more && page.start) st.historyOffset = page.all.length-page.start;
      else if (b.dataset.newer) st.historyOffset = page.offset<=CHAT_PAGE ? 0 : Math.max(CHAT_SHOW,page.offset-CHAT_PAGE);
      else if (b.dataset.latest) st.historyOffset=0;
      paintChat(id);
      const list=box.querySelector(".cmsgs");list.scrollTop=st.historyOffset?0:list.scrollHeight;
    }
    else if (b.dataset.unfilter) toggleChatTool(id, CHAT_TOOL.get(id));
    else if (b.dataset.copy != null) {
      const node = nodeById(id);
      const m = node && (st.renderedMessages || chatMsgs(node, st).shown)[+b.dataset.copy];
      if (m) copyText(m.text, b);
    }
  });
  box.addEventListener("mouseover", (e) => {
    const row = e.target.closest(".cmsg");
    const cts = row && row.querySelector(".cts");
    if (cts) cts.textContent = ago(+cts.dataset.ts);
  });
  const list = box.querySelector(".cmsgs");
  st.renderedMessages = chatMsgs(n,st).shown;
  list.scrollTop = list.scrollHeight;
  list.addEventListener("scroll",()=>{box.querySelector(".chat-jump").hidden=!st.historyOffset&&list.scrollTop+list.clientHeight>=list.scrollHeight-24;},{passive:true});
  box.addEventListener("keydown",e=>{if(e.key==="Escape"&&box.classList.contains("chat-focused")){e.stopPropagation();box.classList.remove("chat-focused");box.querySelector("[data-chat-focus]").setAttribute("aria-pressed","false");}});
  box.querySelector("[data-send]").disabled=!!st.sending||(!ta.value.trim()&&!st.files.length);
  mountChatModel(box, id);
  paintChatModel(box, n, st);
  mountChatAsk(box);
  paintChatAsk(box, id);
  paintPromptComposer(box,n,st);
}

registerBlock({ type: "chat", slot: "main", flex: 7.4, render: chatBlock, mount: mountChat, paint: (box, n) => paintChat(n.id) });

document.addEventListener("selectionchange",()=>{
  const s=getSelection();
  for(const id of [...CHAT_SELECTION_PENDING]){
    const list=ELS.get(id)?.querySelector(".cmsgs");
    if(!list || !s || s.isCollapsed || !list.contains(s.anchorNode)){CHAT_SELECTION_PENDING.delete(id);paintChat(id);}
  }
});
