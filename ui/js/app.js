/* omp-live-map · app · 부트스트랩(첫 스냅샷·SSE·폴러·입력 배선) */

// 첫 스냅샷. 서버가 아직 안 떴으면 3초마다 다시 시도한다.
async function firstGraph() {
  for (;;) {
    try {
      const res = await fetch("/api/graph");
      if (res.ok) return await res.json();
    } catch { /* 서버 대기 */ }
    setConnected(false);
    await new Promise((done) => setTimeout(done, 3000));
  }
}

function applyGraphPatch(previous, patch) {
  if (previous.graphRevision !== patch.baseRevision) return null;
  const sessions = new Map(previous.sessions.map((session) => [session.key, session]));
  for (const key of patch.remove) sessions.delete(key);
  for (const change of patch.sessions) {
    const old = sessions.get(change.key);
    const updates = new Map(change.upsert.map((node) => [node.id, node]));
    let nodes = old?.nodes || [];
    if (change.order) {
      const existing = new Map(nodes.map((node) => [node.id, node]));
      nodes = change.order.map((id) => updates.get(id) ?? existing.get(id));
      if (nodes.includes(undefined)) return null;
    } else if (updates.size) nodes = nodes.map((node) => updates.get(node.id) ?? node);
    const fields = change.fields ?? old;
    if (!fields) return null;
    sessions.set(change.key, { ...fields, nodes });
  }
  const ordered = patch.order ? patch.order.map((key) => sessions.get(key)) : [...sessions.values()];
  if (ordered.includes(undefined)) return null;
  const next = patch.meta ?? previous;
  return { ...next, generatedAt: patch.generatedAt, graphRevision: patch.revision, sessions: ordered };
}

async function boot() {
  bindStageInput();
  bindCardDrag();
  bindCardResize();
  bindMinimap();
  bindSessionList();
  $("nodes").addEventListener("click", onNodesClick);
  // 포인터를 누르고 있는 동안에는 카드를 다시 그리지 않는다(끌기·더블클릭 대상이 바뀌지 않게).
  $("stage").addEventListener("pointerdown", () => { DEFER = true; });
  const release = () => setTimeout(() => { DEFER = false; }, 250);
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);

  // 세션 그래프는 받는 대로 먼저 그린다. 인프라(WSL·Docker 조회는 몇 초 걸릴 수 있다)와 호스트는 도착하면
  // 다시 그리고, 그때까지 사용자가 화면을 움직이지 않았으면 전체가 보이게 한 번 더 맞춘다.
  let touched = false;
  const touch = () => { touched = true; };
  $("stage").addEventListener("pointerdown", touch, { once: true });
  $("stage").addEventListener("wheel", touch, { once: true, passive: true });
  let graphBase=await firstGraph();setGraph(graphBase);
  setConnected(true);
  const mayFit = () => !touched && !wfMap.opening && !wfMap.run;
  renderMap(mayFit(), true);
  Promise.allSettled([fetchInfra(), fetchSys()]).then(() => renderMap(mayFit(), true));

  function connectEvents() {
    const es = new EventSource("/api/events?graph=2");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.live) handleLiveEvent(data.live);
      else if (data.queue) {
        const q = data.queue;
        chatState(q.node).ccQueue = q;
        liveTouch(q.node);
      } else if (data.chat) handleChatEvent(data.chat);
      else if (data.ask) handleAskEvent(data.ask);
      else if (data.graphPatch) {
        const next = applyGraphPatch(graphBase, data.graphPatch);
        if (!next) {
          es.close();
          setConnected(false);
          setTimeout(connectEvents, 300);
          return;
        }
        graphBase = next;
        apply(next, data.graphPatch);
      } else if (data.graphDelta) {
        const { meta, order, remove, upsert } = data.graphDelta;
        const sessions = new Map(graphBase.sessions.map((session) => [session.key, session]));
        for (const key of remove) sessions.delete(key);
        for (const session of upsert) sessions.set(session.key, session);
        graphBase = { ...meta, sessions: order.map((key) => sessions.get(key)).filter(Boolean) };
        apply(graphBase);
      } else {
        graphBase = data;
        apply(data);
      }
    };
  }
  connectEvents();

  function adaptive(fn,ms){let running=false;const tick=async()=>{if(running||document.hidden)return;running=true;try{await fn();}catch{}finally{running=false;}};setInterval(tick,ms);document.addEventListener("visibilitychange",()=>{if(!document.hidden)void tick();});}
  adaptive(loadInfra, 10000);
  adaptive(loadSys, 5000);
  adaptive(()=>{if(LOCALS.length)return loadLocalRes();},10000);
  adaptive(async()=>{for(const id of openIds)if(cardContentVisible(id))await loadBg(id);},2000);
  loadBgAll();
  adaptive(loadBgAll, 5000);
  setInterval(() => { if (!document.hidden && pendingRender && !DEFER && !typingNow()) renderMap(false); }, 700);
  // 도는 잡이 있으면 경과 시간·출력 꼬리가 흐르도록 다시 그린다. 열린 출력은 스크롤 위치를 지킨다.
  setInterval(() => {
    if (!document.hidden && !typingNow() && JOBS.some((j) => !j.done)) renderMap(false);
  }, 2000);
  adaptive(paintJobScroll,1000);
  addEventListener("resize", paintMinimap);
}

boot().catch((e) => {
  $("spath").textContent = "시작 실패: " + e.message;
  console.error(e);
});
