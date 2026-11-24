/* 관제 탐색 및 DOM 갱신: 화면 모드와 독립된 관제 상태 */
let MON_QUERY="", MON_FILTER="all";
const MON_FOLDED=new Set(strList(readJSON("omp-map-mon-folded",[]))), MON_EXPANDED=new Set(), MON_RANK=new Map();
function monitorStableRank(s){if(!MON_RANK.has(s.key))MON_RANK.set(s.key,MON_RANK.size);return MON_RANK.get(s.key);}
function monitorCategory(s){const st=monitorSessionStats(s,overviewMemory),n=st.main;if(!n)return "idle";return askPending(n.id)||st.resourceWarning||ATTN.has(n.id)?"attention":n.status==="live"||st.running?"live":"idle";}
function monitorVisibleSessions(sessions){
  return sessions.filter(s=>{monitorStableRank(s);const n=s.nodes.find(n=>n.kind==="main");const project=monitorProjectFor(n?.cwd||s.folder,MON_PROJECTS);const text=[s.title,s.folder,n?.cwd,ALIAS.get(n?.id),project?.name,...s.nodes.map(a=>a.name)].join(" ").toLowerCase();
    return (!MON_QUERY||text.includes(MON_QUERY))&&(MON_FILTER==="all"||monitorCategory(s)===MON_FILTER);});
}
function paintMonitorSummary(sessions){
  const counts={all:sessions.length,attention:0,live:0,idle:0};for(const s of sessions)counts[monitorCategory(s)]++;
  $("mon-total").textContent=monitorVisibleSessions(sessions).length+" / "+sessions.length+" 세션";
  const html=Object.entries({all:"전체 세션",attention:"주의 필요",live:"실행 중",idle:"유휴·완료"}).map(([k,label])=>`<button data-mon-filter="${k}" aria-pressed="${MON_FILTER===k}" class="${MON_FILTER===k?"on":""}"><span>${label}</span><strong>${counts[k]}</strong></button>`).join("")+`<div class="mon-host"><span>HOST CPU / RAM</span><strong>${SYS?esc(SYS.cpu.pct+"% / "+SYS.mem.usedPct+"%"):"—"}</strong></div>`;
  const el=$("mon-summary");if(el.__html!==html){el.__html=html;el.innerHTML=html;}
}
function patchMonitorGroups(root,html){
  const template=document.createElement("div");template.innerHTML=html;
  const oldGroups=new Map([...root.children].map(e=>[e.dataset.monGroup,e]));
  for(const fresh of [...template.children]){
    const old=oldGroups.get(fresh.dataset.monGroup);
    if(!old||!fresh.dataset.monGroup)continue;
    const a=old.querySelector(".mon-grid"),b=fresh.querySelector(".mon-grid");
    if(!a||!b)continue;
    const oldCards=new Map([...a.children].map(e=>[e.dataset.monId,e]));
    for(const c of [...b.children]){
      const previous=oldCards.get(c.dataset.monId);
      if(!previous)continue;
      if(previous.outerHTML===c.outerHTML||previous.contains(document.activeElement))c.replaceWith(previous);
    }
  }
  const focused=document.activeElement;
  const restore=focused?.isConnected&&root.contains(focused)?focused:null;
  root.replaceChildren(...template.children);
  if(restore?.isConnected)restore.focus({preventScroll:true});
}
$("mon-search").oninput=e=>{MON_QUERY=e.target.value.trim().toLowerCase();paintOverview(filteredSessions());};
$("mon-settings").onclick=()=>{const panel=$("mon-settings-panel");panel.hidden=!panel.hidden;$("mon-settings").setAttribute("aria-expanded",String(!panel.hidden));};
$("mon-sidebar").onclick=()=>{const on=$("app").classList.toggle("mon-show-sidebar");$("mon-sidebar").setAttribute("aria-pressed",String(on));};
$("mon-clear").onclick=()=>{OVERVIEW_SELECTED.clear();paintOverview(filteredSessions());};
/* 관제 카드: 실측 세션 자원과 V3 Engineering 프로젝트/Task/승인 데이터를 표시한다. */
let MON_PROJECTS = [];
const MON_DETAILS = new Map();
let monitorLoading = false;
let monitorSource = window.engineeringDesktop ? "Engineering 데이터 조회 대기" : "일반 브라우저: Engineering 데이터는 데스크톱에서 조회할 수 있습니다.";
let lastOverviewHTML = "", lastAttentionHTML = "";

async function monitorRequest(endpoint, params) {
  const r = await window.engineeringDesktop.request(endpoint, params || {});
  if (!r.ok) throw new Error(r.error || endpoint+" 조회 실패");
  return r.value;
}
async function refreshMonitorProjects() {
  if (!window.engineeringDesktop || monitorLoading || mapMode !== "overview") return;
  monitorLoading = true;
  try {
    MON_PROJECTS = await monitorRequest("projects");
    const active = MON_PROJECTS.filter((p)=>!p.archived);
    await Promise.all(active.map(async (p)=>{
      try {
        const [tasks,approvals,runs] = await Promise.all(["tasks","workflow-approvals","workflow-runs"].map((endpoint)=>monitorRequest(endpoint,{project:p.id})));
        MON_DETAILS.set(p.id,{tasks,approvals,runs,error:null});
      } catch(e) { MON_DETAILS.set(p.id,{...(MON_DETAILS.get(p.id)||{}),error:e.message}); }
    }));
    monitorSource="Engineering 프로젝트/Task 데이터 · "+new Date().toLocaleTimeString("ko-KR");
  } catch(e) { monitorSource="Engineering 조회 실패 · "+e.message; }
  finally { monitorLoading=false; if(mapMode==="overview")paintOverview(filteredSessions()); }
}
const monStatus = {live:"실행 중",idle:"유휴",done:"완료",running:"실행 중",waiting_approval:"승인 대기",blocked:"차단",completed:"완료",backlog:"백로그",ready:"준비"};
const monEngLink = (project,view,run) => "/engineering.html?"+new URLSearchParams({project:project.id,view,...(run?{run}:{})}).toString();
function monitorTaskHTML(g) {
  if (!g.project) return '<p class="mon-muted">등록 프로젝트와 연결되지 않음 · SDLC 진행률 미수집</p>';
  const detail=MON_DETAILS.get(g.project.id);
  if (!detail || detail.error) return '<p class="mon-muted">'+esc(detail?.error || "SDLC 데이터 조회 중")+'</p>';
  const tasks=detail.tasks||[], done=tasks.filter((t)=>t.status==="completed").length;
  const pct=tasks.length?Math.round(done/tasks.length*100):null;
  const current=tasks.find((t)=>t.status==="waiting_approval")||tasks.find((t)=>t.status==="running")||tasks.find((t)=>t.status==="blocked");
  return `<div class="mon-progress"><span>SDLC Task ${done}/${tasks.length} 완료</span><b>${pct===null?"미등록":pct+"%"}</b></div>
    ${pct===null?"":`<progress max="100" value="${pct}" aria-label="Task 완료율"></progress>`}
    ${current?`<p class="mon-task">${esc(monStatus[current.status]||current.status)} · ${esc(current.title)} ${current.latest_run?`<a href="${esc(monEngLink(g.project,"workflow",current.latest_run))}">실행 그래프</a>`:""}</p>`:""}
    <div class="mon-links"><a href="${esc(monEngLink(g.project,"sdlc"))}">개발 Task</a><a href="${esc(monEngLink(g.project,"workflow"))}">Workflow / 타임라인</a><a href="${esc(monEngLink(g.project,"design"))}">하네스·루프</a><a href="${esc(monEngLink(g.project,"execution"))}">실행</a></div>`;
}
function monitorSessionHTML(s) {
  const st=monitorSessionStats(s,overviewMemory), n=st.main;
  if(!n)return "";
  const id=esc(n.id), ask=askPending(n.id), att=ATTN.get(n.id);
  const state=ask?"선택 필요":st.resourceWarning?"RAM 경고":monStatus[n.status]||n.status;
  const tone=ask||st.resourceWarning?"warn":n.status==="live"?"live":"idle";
  const ctx=ctxUsage(n), now=(n.active||[])[0], name=ALIAS.get(n.id)||s.title||n.name;
  const selected=OVERVIEW_SELECTED.has(n.id);
  const work=now?now.name+" · "+cut(now.args||"",85):att?.kind==="done"?"응답 완료":n.lastUser?cut(n.lastUser,95):"최근 활동 미수집";
  return `<article class="mon-card ${tone}${selected?" selected":""}${activeCardId===n.id?" active":""}" data-mon-id="${id}">
    <div class="mon-card-head"><input type="checkbox" data-mon-select="${id}" aria-label="세션 선택"${selected?" checked":""}><button class="mon-name" data-mon-open="${id}" title="${esc(name)}">${esc(name)}</button><span class="mon-state">${esc(state)}</span><button data-mon-menu="${id}" aria-label="카드 메뉴">⋯</button></div>
    <div class="mon-secondary">${harnessChip(n)} ${esc(modelShort(n.model||n.agentModel||"미상"))} · ${PINNED.has(s.key)?"고정 · ":""}${esc(ago(s.lastTs||0))}</div>
    <div class="mon-activity" title="${esc(work)}">${esc(work)}</div>${overviewDensity==="compact"?"":`
    <div class="mon-metrics"><div><small>에이전트</small><strong>${st.running}/${st.total}</strong></div><div><small>컨텍스트</small><strong>${ctx?esc(ctx.text):"—"}</strong></div><div><small>비용</small><strong>${esc(krw(st.cost))}</strong></div><div><small>CPU (코어 합)</small><strong>${st.cpu===null?"—":Math.round(st.cpu)+"%"}</strong></div><div><small>RAM</small><strong>${st.ram===null?"—":esc(memSize(st.ram))}</strong></div><div><small>토큰</small><strong>${esc(fmt(st.tokens))}</strong></div></div>`}
    ${(overviewDensity==="detailed"||MON_EXPANDED.has(n.id))?`<div class="mon-agent-list">${s.nodes.map((a)=>`<button data-mon-open="${esc(a.id)}"><i class="dot ${esc(a.status)}"></i>${esc(a.kind==="main"?"Main":displayName(a))}<span>${esc(monStatus[a.status]||a.status)}</span></button>`).join("")}</div>
      <div class="mon-trend">${(n.res?.hist||[]).length?miniSpark(n.res.hist,170,25,"#4aa8ff"):"CPU 추세 미수집"}<span>누적 오류 ${st.errors}건</span></div>`:""}
    <div class="mon-card-actions"><button class="mon-primary" data-mon-open="${id}">작업 열기 ↗</button><button data-mon-detail="${id}" aria-expanded="${MON_EXPANDED.has(n.id)}">상세</button><button data-mon-map="${id}">지도</button><button data-mon-pin="${id}">${PINNED.has(s.key)?"고정 해제":"고정"}</button>${att?.kind==="done"?`<button data-mon-ack="${id}">완료 확인</button>`:""}</div>
  </article>`;
}
function paintOverview(sessions) {
  const root=$("overview-projects");
  if(!root || mapMode!=="overview")return;
  const score=(s)=>{const st=monitorSessionStats(s,overviewMemory);return (askPending(st.main?.id)?100:0)+(st.resourceWarning?20:0)+(ATTN.has(st.main?.id)?5:0);};
  const cmp=(a,b)=>overviewSort==="memory"?(monitorSessionStats(b,overviewMemory).ram??-1)-(monitorSessionStats(a,overviewMemory).ram??-1):
    overviewSort==="stable"?(monitorStableRank(a)-monitorStableRank(b)):overviewSort==="name"?String(a.title).localeCompare(String(b.title)):overviewSort==="recent"?(b.lastTs||0)-(a.lastTs||0):score(b)-score(a)||(b.lastTs||0)-(a.lastTs||0);
  paintMonitorSummary(sessions);
  const visible=monitorVisibleSessions(sessions);
  const groups=monitorGroupSessions(visible,MON_PROJECTS).filter(g=>g.sessions.length||(!MON_QUERY&&MON_FILTER==="all"));
  groups.sort((a,b)=>(overviewSort==="attention"?Math.max(0,...b.sessions.map(score))-Math.max(0,...a.sessions.map(score)):0)||a.title.localeCompare(b.title));
  const html=groups.map((g)=>`<section class="mon-group" data-mon-group="${esc(g.key)}"><header><h2><button data-mon-fold="${esc(g.key)}" aria-expanded="${!MON_FOLDED.has(g.key)}">${MON_FOLDED.has(g.key)?"▸":"▾"} ${esc(g.title)}</button></h2><span>${g.sessions.length} 세션 ${g.project?"· 기준 브랜치 "+esc(g.project.branch):""}</span></header><div ${MON_FOLDED.has(g.key)?"hidden":""}><p class="mon-path" title="${esc(g.folder)}">${esc(g.folder)}</p>${monitorTaskHTML(g)}<div class="mon-grid">${g.sessions.slice().sort(cmp).map(monitorSessionHTML).join("")||'<p class="mon-muted">표시할 세션 없음</p>'}</div></div></section>`).join("")||'<p class="mon-muted">표시할 프로젝트 또는 세션이 없습니다.</p>';
  root.dataset.density=overviewDensity;
  if(html!==lastOverviewHTML){lastOverviewHTML=html;patchMonitorGroups(root,html); }
  const alerts=[];
  if(SYS?.mem?.usedPct>=85)alerts.push('<span class="mon-alert">HOST RAM '+esc(SYS.mem.usedPct)+'% · 자원 부족</span>');
  for(const s of sessions){
    const st=monitorSessionStats(s,overviewMemory),n=st.main;if(!n)continue;
    if(askPending(n.id)||st.resourceWarning||ATTN.has(n.id))alerts.push(`<button data-mon-open="${esc(n.id)}">${esc(s.title)} · ${askPending(n.id)?"선택 필요":st.resourceWarning?"RAM 경고":"응답 완료"}</button>`);
  }
  for(const p of MON_PROJECTS){const d=MON_DETAILS.get(p.id);if(d?.error)continue;for(const a of d?.approvals||[])alerts.push(`<a href="${esc(monEngLink(p,"workflow",a.run))}">${esc(p.name)} · 승인: ${esc(a.title)}</a>`);}
  const ah=alerts.length?'<h2>주의 필요 · '+alerts.length+'</h2><div>'+alerts.join("")+'</div>':"";
  $("overview-attention").hidden=!alerts.length;
  if(ah!==lastAttentionHTML){lastAttentionHTML=ah;$("overview-attention").innerHTML=ah;}
  $("overview-source").textContent=monitorSource;
  $("mon-selected").textContent=OVERVIEW_SELECTED.size+"개 선택";
  $("mon-batch").classList.toggle("has-selection",OVERVIEW_SELECTED.size>0);
  $("overview-close-selected").disabled=!OVERVIEW_SELECTED.size;
  $("overview-pin-selected").disabled=!OVERVIEW_SELECTED.size;
}
$("overview").addEventListener("click",(e)=>{
  const b=e.target.closest("button");if(!b)return;
  const d=b.dataset;
  if(d.monFilter){MON_FILTER=d.monFilter;paintOverview(filteredSessions());}
  else if(d.monFold){if(MON_FOLDED.has(d.monFold))MON_FOLDED.delete(d.monFold);else MON_FOLDED.add(d.monFold);writeJSON("omp-map-mon-folded",[...MON_FOLDED]);paintOverview(filteredSessions());}
  else if(d.monDetail){if(MON_EXPANDED.has(d.monDetail))MON_EXPANDED.delete(d.monDetail);else MON_EXPANDED.add(d.monDetail);paintOverview(filteredSessions());}
  else if(d.monOpen){setMapMode("workspace",false);openNode(d.monOpen);}
  else if(d.monMap){setMapMode("map",false);openNode(d.monMap);}
  else if(d.monAck){attnClear(d.monAck);paintOverview(filteredSessions());}
  else if(d.monPin){const key=sessionKeyOfNode(d.monPin);if(!key)return;if(PINNED.has(key))PINNED.delete(key);else{PINNED.add(key);HIDDEN.delete(key);}savePinned();saveHidden();renderMap(false,true);}
  else if(d.monMenu){const r=b.getBoundingClientRect();openCardMenu(r.left,r.bottom,d.monMenu);}
});
$("overview").addEventListener("change",(e)=>{
  const id=e.target.dataset.monSelect;if(!id)return;
  if(e.target.checked)OVERVIEW_SELECTED.add(id);else OVERVIEW_SELECTED.delete(id);
  paintOverview(filteredSessions());
});
setInterval(()=>{if(mapMode==="overview")void refreshMonitorProjects();},8000);
if(mapMode==="overview")void refreshMonitorProjects();
