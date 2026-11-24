/* omp-live-map · view · renderMap 오케스트레이션(배치 → 카드 조각 패치 → 관계선·미니맵) */

// 열 배치: key 해시로 열을 고정한다(높이순 그리디는 카드 높이가 조금만 변해도 자리를 바꾼다).
// 사용자가 끌어 놓은 클러스터(MANUAL: HOST·인프라)는 그 자리에 두고 자동 흐름에서 빼서 빈자리를 남기지 않는다.
function placeBlocks(blocks) {
  const cols = chooseCols(blocks.length);
  const buckets = Array.from({ length: cols }, () => []);
  for (const b of blocks) buckets[keyHash(blockKeyOf(b)) % cols].push(b);
  let x0 = 0;
  for (const col of buckets) {
    col.sort((a, b) => (blockKeyOf(a) < blockKeyOf(b) ? -1 : 1));
    let y0 = 0;
    let w = 0;
    for (const b of col) {
      const m = MANUAL[b.kind];
      if (m) { b.place(m.x, m.y); continue; }
      b.place(x0, y0);
      y0 += b.h + 40;
      w = Math.max(w, b.w);
    }
    if (w) x0 += w + 44;
  }
}

function placeLocals() {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const L of LOCALS) {
    geo.set(L.id, { x: L.x, y: L.y, w: AG.W, h: AG.H });
    CLUSTERS.push({ kind: "local", key: L.id, members: [L.id], x: L.x - 16, y: L.y - 62, w: AG.W + 32, h: AG.H + 94, fixed: true,
      title: L.title, folder: L.cwd || "", live: true, lastTs: Date.now(), agents: 0, tokens: zero, cost: 0, jobs: [], jobTotal: 0 });
  }
}

// 큰 카드 자리: 처음 열 때 한 번만 정하고 카드별로 고정한다. 세션 에이전트는 지금 화면 안 빈 자리, 로컬·인프라는 클러스터 옆.
function placeBigCards() {
  SATS = new Map();
  if (typeof syncSubDocks === "function") syncSubDocks();   // 열린 메인에 실행 중 서브 카드를 자동으로 연다
  let changed = false;
  for (const id of openIds) {
    if (!nodeById(id)) continue;
    let box = BIGPOS.get(id);
    if (!box) {
      const anchor = clusterOfCard(id);
      box = anchor ? placeSatellite(anchor) : placeInView(BIG_W, BIG_H);
      BIGPOS.set(id, box);
      changed = true;
    }
    SATS.set(id, { x: box.x, y: box.y, w: box.w || BIG_W, h: box.h || BIG_H });
  }
  if (typeof placeDocked === "function" && placeDocked()) changed = true;   // 도킹 서브는 메인 오른쪽에 붙인다
  if (changed) saveOpenCards();
}

function topbarStatus(sessions) {
  $("spath").textContent = NODES.length
    ? `${sessions.length} session · ${NODES.filter((n) => agentKind(n.kind)).length} agent · ${(INFRA.containers || []).length} container`
    : "표시할 세션이 없습니다 — 필터를 넓혀 보세요";
  const ub = $("unhide");
  ub.hidden = !HIDDEN.size;
  ub.textContent = `숨김 ${HIDDEN.size} 복원`;
  paintDoneSubsButton(HIDE_DONE_SUBS);
}

function renderMap(resetView, force) {
  if (!force && (DEFER || typingNow())) { pendingRender = true; return; }
  pendingRender = false;
  geo = new Map();
  CLUSTERS = [];
  const sessions = filteredSessions();
  NODES = [...agentNodes(sessions), ...infraNodes(), ...LOCALS.map(localNode)];
  for (const id of [...openIds]) {
    if (!NODES.some((n) => n.id === id) && !SWITCH_HOLD.has(id)) closeCard(id);
  }

  // HOST·인프라·로컬 배치 → 겹침 회피 → 큰 카드 → 세션 잡 → 연결선
  placeBlocks(buildBlocks());
  placeLocals();
  separateCards();
  placeBigCards();
  JOBS = sessionJobs(sessions);
  topbarStatus(sessions);

  const box = $("nodes");
  const painted = new Set();
  const pieces = CLUSTERS.map((c) => ({ key: "c:" + clusterKeyOf(c), html: clusterHTML(c) }));
  pieces.push(...hostCards());
  pieces.push(...pendingPieces());
  pieces.push(...JOBS.map((j) => ({ key: "j:" + jobKeyOf(j), html: jobCard(j, { x: 0, y: 0 }) })));
  for (const n of NODES) {
    if (!agentKind(n.kind)) pieces.push({ key: "n:" + n.id, html: plainCard(n) });
    if (openIds.has(n.id)) { const piece = cardRenderPiece(n, force); pieces.push(piece); if (!piece.retain && !piece.virtual) painted.add(n.id); }
  }
  patchPieces(box, pieces);
  ELS.clear();
  box.querySelectorAll(".node[data-id]").forEach((el) => ELS.set(el.dataset.id, el));
  drawEdges(NODES);
  for (const id of painted) { mountBlocks(nodeById(id), ELS.get(id)); restoreCardScroll(id, ELS.get(id)); }
  box.querySelectorAll("input.rename").forEach(wireRename);
  paintSelection();
  renderSessionList(sessions);
  paintActiveCards();
  paintGroupCards();
  for (const el of box.querySelectorAll(".node.big")) paintBlockFocus(el);
  if (typeof paintAttention === "function") paintAttention();
  paintMonitor(sessions);
  if (resetView && mapMode === "map") fit(); else paintMinimap();
}
