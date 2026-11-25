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
  setGraph(await firstGraph());
  setConnected(true);
  renderMap(true, true);
  Promise.allSettled([fetchInfra(), fetchSys()]).then(() => renderMap(!touched, true));

  const es = new EventSource("/api/events");
  es.onopen = () => setConnected(true);
  es.onerror = () => setConnected(false);   // EventSource 가 알아서 다시 붙는다
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.live) handleLiveEvent(data.live);
    else if(data.queue){const q=data.queue;chatState(q.node).ccQueue=q;liveTouch(q.node);return;} else if (data.chat) handleChatEvent(data.chat);
    else if (data.ask) handleAskEvent(data.ask);
    else apply(data);
  };

  setInterval(loadInfra, 5000);
  setInterval(loadSys, 3000);
  setInterval(() => { if (LOCALS.length) loadLocalRes(); }, 5000);
  setInterval(() => { for (const id of openIds) if(cardContentVisible(id)) loadBg(id); }, 1200);
  loadBgAll();
  setInterval(loadBgAll, 2500);
  setInterval(() => { if (pendingRender && !DEFER && !typingNow()) renderMap(false); }, 700);
  // 도는 잡이 있으면 경과 시간·출력 꼬리가 흐르도록 다시 그린다. 열린 출력은 스크롤 위치를 지킨다.
  setInterval(() => {
    if (!typingNow() && JOBS.some((j) => !j.done)) renderMap(false);
  }, 2000);
  setInterval(paintJobScroll, 500);
  addEventListener("resize", paintMinimap);
}

boot().catch((e) => {
  $("spath").textContent = "시작 실패: " + e.message;
  console.error(e);
});
