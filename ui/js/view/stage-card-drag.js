/* omp-live-map · view · 큰 카드·클러스터 끌기 (큰 카드는 따로, 묶음은 제목으로) */
// 끌기 규칙
//   열린 큰 카드: 그 카드의 BIGPOS 와 붙은(도킹) 서브 카드만 같이 움직인다. 서브를 직접 끌면 도킹이 풀린다.
//   클러스터 제목·HOST·인프라·로컬 카드: 선택한 클러스터(작은 카드·잡·그 클러스터의 큰 카드)를 같은 Δ만큼 옮긴다.
//   세션 에이전트는 지도에 큰 카드로만 있고 작은 카드·클러스터 테두리가 없다.
//   Esc·pointercancel 은 임시 위치를 취소하고(저장·이력 없음), 이동 중 Ctrl+Z 도 먼저 이동을 취소한다.

let cardDrag = null;   // 진행 중인 끌기 { mode, id, items, restore, snap, ... }

// 끌기를 시작한 자리에서 소속 클러스터를 찾는다(큰 카드는 클러스터가 없을 수 있다).
function dragClusterAt(target, el) {
  const head = target.closest(".cluster .ch");
  if (head) return clusterByKey(head.parentElement.dataset.ckey);
  if (!el) return null;
  if (el.dataset.metric) return clusterByKey("host:host");
  return clusterOfCard(el.dataset.id);
}

// 무엇을 잡았는지로 범위를 정한다: big(열린 큰 카드) | cluster(제목·HOST·인프라·로컬 작은 카드).
const dragModeOf = (el) => (el && el.classList.contains("big") ? "big" : "cluster");

// 진행 중인 끌기를 취소한다. 화면만 시작 위치로 돌리고 저장·이력은 남기지 않는다.
function cancelCardDrag() {
  const d = cardDrag;
  if (!d) return false;
  cardDrag = null;
  drawGuides([]);
  d.grip.classList.remove("dragging");
  for (const it of d.restore) it.el.style.cssText = it.css;
  if (d.moved) { suppressClickUntil = Date.now() + 300; scheduleEdges(); }
  return true;
}

function startCardDrag(e) {
  if (e.button !== 0 || spaceDown) return;
  const el = e.target.closest(".node");
  if (e.target.closest(CARD_INTERACTIVE)) return;
  const mode = dragModeOf(el);
  const c = dragClusterAt(e.target, el);
  if (mode === "cluster" && !c) return;
  e.preventDefault();
  if (c) {
    const key = clusterKeyOf(c);
    if (e.shiftKey) {
      if (SELECTED.has(key)) SELECTED.delete(key); else SELECTED.add(key);
      paintSelection();
      return;
    }
    if (mode === "cluster" && !SELECTED.has(key)) selectOnly(c);
  } else if (e.shiftKey) return;
  const id = el && el.dataset.id;
  const d = { mode, id, owner: c, sx: e.clientX, sy: e.clientY, moved: false, dx: 0, dy: 0,
    grip: el || e.target.closest(".cluster .ch") };
  if (mode === "big") {
    const docked = typeof dockDragExtras === "function" && id ? dockDragExtras(id) : [];
    d.items = d.restore = [itemOf(el), ...docked];
    d.rect = SATS.get(id);
    d.skip = () => false;
  } else {
    // 포인터 시작 시 대상을 고정한다. 이동 중 새로 생긴 카드는 합류시키지 않는다.
    d.list = CLUSTERS.filter((x) => SELECTED.has(clusterKeyOf(x)));
    d.items = d.restore = clusterItems(d.list);
    d.rect = c;
    d.skip = (o) => SELECTED.has(clusterKeyOf(o));
  }
  if (!d.rect) return;
  cardDrag = d;
}

function moveCardDrag(e) {
  const d = cardDrag;
  if (!d) return;
  if (!(e.buttons & 1)) return finishCardDrag();   // 캡처 전에 영역 밖에서 버튼을 뗀 경우
  const dx = (e.clientX - d.sx) / view.k;
  const dy = (e.clientY - d.sy) / view.k;
  if (!d.moved) {
    if (Math.hypot(dx * view.k, dy * view.k) < 5) return;
    // 움직이기 시작한 뒤에만 포인터를 잡는다. 제자리 클릭은 원래 대상에 click 이 간다.
    d.moved = true;
    d.grip.setPointerCapture(e.pointerId);
    d.grip.classList.add("dragging");
    // 첫 유효 이동 직전 상태를 이력으로 잡아 둔다(도킹 서브 자리는 렌더가 메인 옆으로 다시 맞춘다).
    d.snap = layoutSnapshot(d.mode === "big" ? { big: [d.id] } : clusterKeys(d.list));
  }
  const snap = snapDelta(d.rect, dx, dy, d.skip);
  d.dx = snap.dx;
  d.dy = snap.dy;
  for (const it of d.items) {
    it.el.style.left = it.left + snap.dx + "px";
    it.el.style.top = it.top + snap.dy + "px";
  }
  drawGuides(snap.guides);
  scheduleEdges();
}

function finishCardDrag() {
  const d = cardDrag;
  if (!d) return;
  cardDrag = null;
  drawGuides([]);
  d.grip.classList.remove("dragging");
  if (!d.moved) return;
  pushHistory(d.snap);
  if (d.mode === "big") {
    BIGPOS.set(d.id, { x: d.rect.x + d.dx, y: d.rect.y + d.dy, w: d.rect.w, h: d.rect.h });
    if (typeof dockOnMoved === "function") dockOnMoved(d.id);   // 서브를 직접 끌면 도킹 해제(연결선은 유지)
  } else moveClusters(d.list, d.dx, d.dy);
  saveLocals();
  saveManual();
  saveOpenCards();
  suppressClickUntil = Date.now() + 300;
  // 끌기 직후에는 DEFER·입력 포커스와 무관하게 한 번 강제로 맞춘다(끄는 동안 미룬 데이터 갱신도 여기서 합친다).
  renderMap(false, true);
}

function bindCardDrag() {
  const box = $("nodes");
  box.addEventListener("pointerdown", startCardDrag);
  box.addEventListener("pointermove", moveCardDrag);
  box.addEventListener("pointerup", finishCardDrag);
  box.addEventListener("pointercancel", cancelCardDrag);
}
