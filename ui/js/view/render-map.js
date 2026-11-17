/* omp-live-map · view · renderMap 오케스트레이션(배치 → 카드 조각 패치 → 관계선·미니맵) */

// 열 배치: key 해시로 열을 고정한다(높이순 그리디는 카드 높이가 조금만 변해도 자리를 바꾼다).
// 사용자가 끌어 놓은 클러스터(MANUAL)는 그 자리에 두고 자동 흐름에서 빼서 빈자리를 남기지 않는다.
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
      const m = MANUAL[b.kind === "session" ? b.s.key : b.kind];
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
    CLUSTERS.push({ kind: "local", key: L.id, members: [L.id], x: L.x - 16, y: L.y - 62, w: AG.W + 32, h: AG.H + 94, fixed: LAYOUT_V2,
      title: L.title, folder: L.cwd || "", live: true, lastTs: Date.now(), agents: 0, tokens: zero, cost: 0, jobs: [], jobTotal: 0 });
  }
}

// 큰 카드 자리: 처음 열 때 클러스터 옆 빈 곳에 놓고 카드별로 고정한다.
function placeBigCards() {
  SATS = new Map();
  if (typeof syncSubDocks === "function") syncSubDocks();   // 열린 메인에 실행 중 서브 카드를 자동으로 연다
  let changed = false;
  for (const id of openIds) {
    if (!geo.has(id)) continue;
    let box = BIGPOS.get(id);
    if (!box) {
      box = placeSatellite(clusterOfCard(id) || geo.get(id));
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
    if (!NODES.some((n) => n.id === id)) closeCard(id);
  }

  // 저장 위치·크기 적용 → 새 카드만 배치 → 테두리 → (새 클러스터만) 겹침 회피 → 좌표 저장 → 큰 카드 → 연결선
  placeBlocks(buildBlocks(sessions));
  placeLocals();
  separateCards();
  commitLayout();
  placeBigCards();
  topbarStatus(sessions);

  const box = $("nodes");
  const pieces = CLUSTERS.map((c) => ({ key: "c:" + clusterKeyOf(c), html: clusterHTML(c) }));
  pieces.push(...hostCards());
  pieces.push(...pendingPieces());
  for (const n of NODES) {
    if (!openIds.has(n.id)) { pieces.push({ key: "n:" + n.id, html: smallCard(n) }); continue; }
    pieces.push({ key: "g:" + n.id, html: ghostCard(n) });
    pieces.push({ key: "n:" + n.id, html: bigCard(n), keep: ".body" });
  }
  patchPieces(box, pieces);
  ELS.clear();
  box.querySelectorAll(".node[data-id]").forEach((el) => ELS.set(el.dataset.id, el));
  drawEdges(NODES);
  for (const id of openIds) mountBlocks(nodeById(id), ELS.get(id));
  box.querySelectorAll("input.rename").forEach(wireRename);
  paintSelection();
  if (typeof paintAttention === "function") paintAttention();
  if (resetView) fit(); else paintMinimap();
}
