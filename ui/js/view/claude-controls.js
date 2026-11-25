/* Claude controls: actual server queue and discovered CLI capabilities. */
async function ccPost(path,body){try{const r=await postJSON(path,body);return await r.json();}catch(e){return {ok:false,out:e.message};}}
async function refreshClaudeQueue(id){
 const s=chatState(id);if(s.ccQueueLoading)return;s.ccQueueLoading=true;
 try{const r=await ccPost("/api/claude/queue",{node:id,action:"list"});if(r.ok)s.ccQueue=r;}finally{s.ccQueueLoading=false;paintChat(id);}
}
async function enqueueClaudePrompt(id){
 const s=chatState(id);if(s.sending)return;const text=s.draft,files=s.files;s.sending=true;paintChat(id);
 const r=await ccPost("/api/claude/queue",{node:id,action:"enqueue",text,files:attachPayload(files)});
 s.sending=false;if(r.ok){if(s.draft===text)s.draft="";if(s.files===files){clearAttachments(files);s.files=[];}rememberPrompt(id,text);persistPromptDraft(id,s);s.ccQueue=r;}else s.error=r.out||"예약 실패";paintChat(id);
}
function claudeControlHTML(n){return capsOf(n).id==="claude"?'<button data-cc-action="settings">Claude 설정</button><div class="cc-panel" hidden></div><div class="cc-queue" hidden></div>':"";}
function paintClaudeControls(box,n,s){
 if(capsOf(n).id!=="claude")return;const q=box.querySelector(".cc-queue");if(!q)return;const v=s.ccQueue;q.hidden=!v?.items?.length&&!v?.paused;
 const html=v?`<header>서버 예약 ${v.items.length}건 · ${v.paused?"일시정지":"실행 가능"} <button data-cc-action="pause">정지</button><button data-cc-action="resume">재개</button><button data-cc-action="refresh">갱신</button></header>${esc(v.error||"")}`+v.items.map(x=>`<div class="prompt-queue-row"><span title="${esc(x.text)}">${esc(cut(x.text,100))}</span>${["edit","up","down","delete"].map(a=>`<button data-cc-action="${a}" data-cc-id="${esc(x.id)}">${{edit:"수정",up:"↑",down:"↓",delete:"삭제"}[a]}</button>`).join("")}</div>`).join(""):"";
 if(q.__html!==html){q.__html=html;q.innerHTML=html;}
}
function mountClaudeControls(box,n,s){
 if(capsOf(n).id!=="claude")return;const id=n.id,panel=box.querySelector(".cc-panel");
 void refreshClaudeQueue(id);
 box.addEventListener("click",async e=>{
 const b=e.target.closest("[data-cc-action]");if(!b)return;const a=b.dataset.ccAction;
 if(a==="settings"){panel.hidden=!panel.hidden;if(panel.hidden)return;panel.textContent="CLI 확인 중…";
 const [status,opts,info]=await Promise.all([fetch("/api/claude/status").then(r=>r.json()).catch(()=>({})),ccPost("/api/claude/options",{node:id}),ccPost("/api/claude/project-info",{node:id})]);
 const o=opts.options||{},auth=status.auth||{};
 panel.innerHTML=`<div>CLI: ${esc(status.version||"미설치/확인 실패")} · 인증: ${auth.loggedIn===true?"로그인":auth.loggedIn===false?"미로그인":"미확인"} · ${esc(auth.method||"미확인")}</div><div>API 키 환경변수: ${auth.apiKeyPresent?"설정됨":"없음"} · 동시 실행 한도 ${opts.maxRuns||"—"}</div><label>권한 <select class="cc-permission">${["default","acceptEdits","plan","dontAsk"].map(v=>`<option ${o.permission===v?"selected":""}>${v}</option>`).join("")}</select></label><label>Effort <select class="cc-effort" ${status.effort?"":"disabled"}>${["default","low","medium","high","max"].map(v=>`<option ${o.effort===v?"selected":""}>${v}</option>`).join("")}</select></label><button data-cc-action="save">저장</button><div class="cc-note"></div><details><summary>로그인 안내</summary>로컬 터미널에서 claude auth login 실행 후 갱신하세요. 인증정보는 앱에서 수집하지 않습니다.</details><details><summary>최근 실행 진단</summary><pre>${esc(opts.diagnostics?.stderr||"진단 없음")}</pre></details><details><summary>프로젝트 설정 파일 · ${info.sources?.length||0}개</summary>${(info.sources||[]).map(x=>`<div title="${esc(x.path)}">${esc(x.type)} · ${esc(x.path)}</div>`).join("")}</details>`;
 }else if(a==="save"){const r=await ccPost("/api/claude/options",{node:id,options:{permission:panel.querySelector(".cc-permission").value,effort:panel.querySelector(".cc-effort").value}});panel.querySelector(".cc-note").textContent=r.ok?"저장 완료 · 다음 실행 적용":r.out;}
 else if(a==="refresh")void refreshClaudeQueue(id);
 else{let value;const item=s.ccQueue?.items?.find(x=>x.id===b.dataset.ccId);if(a==="edit"){value=prompt("예약 지시 수정",item?.text||"");if(value===null)return;}if(a==="delete"&&!confirm("예약 지시를 삭제할까요?"))return;const r=await ccPost("/api/claude/queue",{node:id,action:a,id:b.dataset.ccId,text:value});if(r.ok)s.ccQueue=r;else s.error=r.out;paintChat(id);}
 });
}
