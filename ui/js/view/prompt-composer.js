/* Composer controls, local references and templates; no speculative token estimate. */
function promptToolbarHTML(n,s){
  return `<div class="prompt-meta"><span class="prompt-state"></span><span class="prompt-context"></span><span class="prompt-cwd" title="${esc(n.cwd||"")}">${esc(n.cwd||"작업 경로 미수집")}</span><button data-prompt-action="expand" title="입력창 확대/복원">⛶</button></div>
  <details class="prompt-secondary"><summary>입력 도구 · 설정</summary><div class="prompt-tools">${claudeControlHTML(n)}<button data-prompt-action="history">이전 지시</button><button data-prompt-action="templates">템플릿</button><button data-prompt-action="preview">Markdown</button><button data-prompt-action="refs">@ 파일</button><button data-prompt-action="commands">/ 명령</button><button data-prompt-action="tasks"># Task</button><select class="prompt-shortcut" aria-label="전송 단축키"><option value="ctrl">Ctrl+Enter 전송</option><option value="enter">Enter 전송</option></select></div></details>`;
}
function paintPromptComposer(box,n,s){
  paintClaudeControls(box,n,s);
  const id=n.id,ta=box.querySelector(".cin"),connected=promptConnected(),busy=promptBusy(id),ask=askPending(id);
  box.querySelector(".prompt-state").textContent=!connected?"연결 끊김":ask?"응답 선택 필요":s.sending?"전송 중":busy?"작업 중":"입력 가능";
  const ctx=ctxUsage(n);box.querySelector(".prompt-context").textContent="컨텍스트 "+(Number.isFinite(ctx?.pct)?Math.round(ctx.pct)+"%":ctx?.text||"미수집");
  const mode=box.querySelector(".prompt-mode");mode.value=s.sendMode||"steer";mode.options[0].disabled=busy&&capsOf(n).id==="claude";
  if(mode.options[0].disabled){mode.value="queue";}
  const send=box.querySelector("[data-send]");send.disabled=!promptCanSend(id)||dockReadOnly(id);
  send.textContent=mode.value==="queue"?"예약 ↑":busy?"추가 지시 ↑":"보내기 ↑";
  const hint=box.querySelector(".chat-hint");hint.textContent=(s.storageError?"초안 저장 실패":s.draft?"초안 로컬 저장":"초안 없음")+" · "+(s.shortcut==="enter"?"Enter 전송 / Shift+Enter 줄바꿈":"Ctrl+Enter 전송 / Enter 줄바꿈")+" · 첨부는 새로고침 전까지만 유지";
  const prev=box.querySelector(".prompt-preview");prev.hidden=!s.preview;ta.hidden=!!s.preview;
  if(s.preview){const html=mdHTML(s.draft||"",true);if(prev.__html!==html){prev.__html=html;prev.innerHTML=html;}}
  const q=promptQueue(id),panel=box.querySelector(".prompt-queue");panel.hidden=!q.length;
  const html=q.length?`<header>예약 지시 ${q.length}건 · ${s.queuePaused?"일시정지":s.queueRunning?"전송 중":"현재 창에서만 실행"}<button data-prompt-action="resume">재개</button><button data-prompt-action="pause">일시정지</button></header>`+q.map((x,i)=>`<div class="prompt-queue-row"><span title="${esc(x.text)}">${i+1}. ${esc(cut(x.text||"첨부 지시",100))} ${x.files.length?"· 첨부 "+x.files.length+"개":""}</span>${["edit","up","down","delete"].map(a=>`<button data-prompt-queue="${a}" data-index="${i}" ${s.queueRunning?"disabled":""}>${{edit:"수정",up:"↑",down:"↓",delete:"삭제"}[a]}</button>`).join("")}</div>`).join(""):"";
  if(panel.__html!==html){panel.__html=html;panel.innerHTML=html;}
}
function promptInsert(box,s,text,replace=false){
  const ta=box.querySelector(".cin");s.preview=false;ta.hidden=false;
  if(replace)ta.value=text;else ta.setRangeText(text,ta.selectionStart,ta.selectionEnd,"end");
  s.draft=ta.value;ta.dispatchEvent(new Event("input",{bubbles:true}));ta.focus();
}
function mountPromptComposer(box,n,s){
  mountClaudeControls(box,n,s);
  const id=n.id,ta=box.querySelector(".cin"),list=box.querySelector(".prompt-suggestions"),mode=box.querySelector(".prompt-mode"),shortcut=box.querySelector(".prompt-shortcut");
  s.shortcut=readJSON("omp-map-prompt-shortcut","ctrl")==="enter"?"enter":"ctrl";shortcut.value=s.shortcut;
  let generation=0,tokenStart=null,timer=null;const refCache=new Map();
  const close=()=>{clearTimeout(timer);generation++;list.hidden=true;list.innerHTML="";tokenStart=null;};
  const show=(rows,empty="항목 없음")=>{list.hidden=false;list.innerHTML=rows.length?rows.map((r,i)=>`<button data-prompt-choice="${i}" title="${esc(r.label)}">${esc(r.label)}</button>`).join(""):`<span>${esc(empty)}</span>`;list.__rows=rows;delete list.dataset.choice;};
  const commands=[{label:"/compact — 컨텍스트 압축",run:()=>{if(capsOf(n).compact)compactChat(id);}},{label:"/clear — 대화 비우기",run:()=>{if(capsOf(n).clear)clearChat(id);}},{label:"요약 — 세션 요약",run:()=>summarize(id)}];
  async function choices(kind,q=""){
    const gen=++generation,query=q.toLowerCase();
    if(kind==="history"){show(promptHistory(id).map(t=>({label:cut(t,100),text:t,replace:true})));return;}
    if(kind==="templates"){show([{label:"+ 현재 초안 템플릿 저장",run:()=>{if(!s.draft.trim())return;const name=prompt("템플릿 이름");if(name&&!savePromptTemplates([{name,text:s.draft},...promptTemplates().filter(t=>t.name!==name)])){s.error="템플릿 저장 실패";paintChat(id);}}},...promptTemplates().filter(t=>t.name.toLowerCase().includes(query)).flatMap(t=>[{label:t.name,text:t.text,replace:false},{label:"수정 · "+t.name,run:()=>{const name=prompt("템플릿 이름",t.name);if(!name?.trim())return;const text=prompt("템플릿 내용",t.text);if(text===null)return;savePromptTemplates([{name:name.trim(),text},...promptTemplates().filter(x=>x.name!==t.name&&x.name!==name.trim())]);}},{label:"삭제 · "+t.name,run:()=>{if(confirm("템플릿을 삭제할까요?"))savePromptTemplates(promptTemplates().filter(x=>x.name!==t.name));}}])]);return;}
    if(kind==="commands"){show(commands.filter(c=>c.label.toLowerCase().includes(query)).filter(c=>!c.label.startsWith("/compact")||capsOf(n).compact).filter(c=>!c.label.startsWith("/clear")||capsOf(n).clear));return;}
    if(kind==="refs"){
      if(!n.cwd){show([],"작업 디렉터리 미수집");return;}
      show([],"파일 조회 중…");
      try{let data=refCache.get(n.cwd);if(!data||Date.now()-data.at>10000){const r=await fetch("/api/tree?p="+encodeURIComponent(n.cwd)+"&d=2");data={...(await r.json()),at:Date.now()};refCache.set(n.cwd,data);}if(gen!==generation)return;
        const rows=[];function walk(entries){for(const e of entries||[]){if(rows.length>=100)return;const rel=String(e.path||"");if(rel.toLowerCase().includes(query))rows.push({label:rel,text:"@"+(rel.includes(" ")?JSON.stringify(rel):rel)+" "});walk(e.children);}}walk(data.entries);show(rows,"일치하는 파일 없음");
      }catch{if(gen===generation)show([],"파일 조회 실패");}return;
    }
    if(kind==="tasks"){
      try{const r=await window.engineeringApi.request("projects",{});if(!r.ok)throw Error(r.error);const p=monitorProjectFor(n.cwd,r.value||[]);if(!p){show([],"연결된 프로젝트 없음");return;}const t=await window.engineeringApi.request("tasks",{project:p.id});if(!t.ok)throw Error(t.error);if(gen!==generation)return;show((t.value||[]).filter(x=>String(x.title+" "+x.id).toLowerCase().includes(query)).map(x=>({label:x.title,text:"#Task "+x.id+" ("+x.title+") "})));}catch{if(gen===generation)show([],"Task 조회 실패");}
    }
  }
  ta.addEventListener("input",()=>{s.draft=ta.value;persistPromptDraft(id,s);fitChatInput(ta);paintPromptComposer(box,n,s);const m=ta.value.slice(0,ta.selectionStart).match(/(?:^|\s)([@/#])([^\s@/#]*)$/);if(m){tokenStart=ta.selectionStart-m[1].length-m[2].length;clearTimeout(timer);generation++;timer=setTimeout(()=>void choices({"@":"refs","/":"commands","#":"tasks"}[m[1]],m[2]),180);}else close();});
  ta.addEventListener("keydown",e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(!list.hidden&&["ArrowDown","ArrowUp"].includes(e.key)){e.preventDefault();const buttons=[...list.querySelectorAll("button")];if(buttons.length){const i=Number(list.dataset.choice||"-1");const next=(i+(e.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;list.dataset.choice=String(next);buttons.forEach((b,j)=>b.classList.toggle("choice-active",j===next));buttons[next].scrollIntoView({block:"nearest"});}return;}
    if(!list.hidden&&e.key==="Enter"&&!e.ctrlKey&&!e.metaKey&&list.dataset.choice!==undefined){const b=list.querySelectorAll("button")[Number(list.dataset.choice)];if(b){e.preventDefault();b.click();return;}}
    if(e.key==="Escape"&&!list.hidden){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==="Enter"&&((e.ctrlKey||e.metaKey)||(s.shortcut==="enter"&&!e.shiftKey))){e.preventDefault();e.stopPropagation();submitPrompt(id);}
  });
  mode.onchange=()=>{s.sendMode=mode.value;paintPromptComposer(box,n,s);};
  shortcut.onchange=()=>{s.shortcut=shortcut.value;try{writeJSON("omp-map-prompt-shortcut",s.shortcut);}catch{}paintPromptComposer(box,n,s);};
  box.addEventListener("click",e=>{
    const b=e.target.closest("button");if(!b)return;const a=b.dataset.promptAction;
    if(b.dataset.promptQueue){queuePromptChange(id,+b.dataset.index,b.dataset.promptQueue);return;}
    if(b.dataset.promptChoice!==undefined){const r=list.__rows?.[+b.dataset.promptChoice];if(!r)return;const start=tokenStart;close();if(r.replace&&s.draft&&!confirm("현재 초안을 교체할까요?"))return;if(r.run){if(start!==null){ta.setRangeText("",start,ta.selectionStart,"end");s.draft=ta.value;persistPromptDraft(id,s);}r.run();}else{if(start!==null)ta.setSelectionRange(start,ta.selectionStart);promptInsert(box,s,r.text,r.replace);}return;}
    if(!a)return;
    if(a==="expand"){s.expanded=!s.expanded;if(!s.expanded)s.manualHeight=0;fitChatInput(ta);b.setAttribute("aria-pressed",String(!!s.expanded));}
    else if(a==="preview"){s.preview=!s.preview;paintPromptComposer(box,n,s);if(!s.preview)ta.focus();}
    else if(a==="resume"){s.queuePaused=false;void drainPromptQueue(id,true);paintPromptComposer(box,n,s);}
    else if(a==="pause"){s.queuePaused=true;paintPromptComposer(box,n,s);}
    else{tokenStart=null;void choices(a);}
  });
  const grip=document.createElement("button");grip.className="prompt-grip";grip.type="button";grip.textContent="↕";grip.title="끌어서 입력창 높이 조절";box.querySelector(".crow").append(grip);
  grip.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();grip.setPointerCapture(e.pointerId);const y=e.clientY,h=ta.offsetHeight;const move=ev=>{s.manualHeight=Math.max(80,h+ev.clientY-y);fitChatInput(ta);};const stop=()=>{grip.removeEventListener("pointermove",move);grip.removeEventListener("pointerup",stop);grip.removeEventListener("pointercancel",stop);};grip.addEventListener("pointermove",move);grip.addEventListener("pointerup",stop);grip.addEventListener("pointercancel",stop);});
  paintPromptComposer(box,n,s);
}
