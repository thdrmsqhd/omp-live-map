/* omp-live-map · view · 카드·클러스터 끌기 (카드는 따로, 묶음은 제목으로) */
// 끌기 규칙 (docs/analysis/card-independent-movement.html A안)
//   작은 카드(메인·서브)·미러 카드: 그 카드의 지도 좌표(MANUAL["card:"+id])만 바꾼다. 자식·형제·잡은 그대로.
//   열린 큰 카드: BIGPOS[id] 만 바꾼다.
//   클러스터 제목: 선택한 클러스터의 작은 카드·미러·잡·열린 큰 카드와 숨긴 구성원의 저장 좌표를 같은 Δ만큼 옮긴다.
//   HOST·인프라·로컬 카드는 예전처럼 클러스터째 움직인다.
//   Esc·pointercancel 은 임시 위치를 취소하고(저장·이력 없음), 이동 중 Ctrl+Z 도 먼저 이동을 취소한다.

let cardDrag = null;   // 진행 중인 끌기 { mode, id, items, restore, snap, ... }

// 끌기를 시작한 자리에서 소속 클러스터를 찾는다.
function dragClusterAt(target, el) {
  const head = target.closest(".cluster .ch");
  if (head) return clusterByKey(head.parentElement.dataset.ckey);
  if (!el) return null;
  if (el.dataset.metric) return clusterByKey("host:host");
  return clusterOfCard(el.dataset.id || el.dataset.ghost);
}

// 무엇을 잡았는지로 범위를 정한다: card(작은 카드·미러) | big(열린 큰 카드) | cluster(제목·HOST·인프라·로컬).
function dragModeOf(target, el) {
  if (target.closest(".cluster .ch") || !el) return "cluster";
  if (el.classList.contains("big")) return "big";
  const n = nodeById(el.dataset.id || el.dataset.ghost);
  return n && agentKind(n.kind) ? "card" : "cluster";
}

// 카드 하나를 끄는 동안 소속 클러스터 테두리를 임시 좌표로 다시 감싼다(잡 카드는 프레임 기준 좌표라 함께 보정).
function previewFrame(d, dx, dy) {
  if (!d.frame || d.owner.kind !== "session") return;
  const g = geo.get(d.id);
  const b = clusterBox(d.owner, (id) => (id === d.id ? { ...g, x: g.x + dx, y: g.y + dy } : geo.get(id)));
  Object.assign(d.frame.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
  const jobs = d.owner.jobs || [];
  d.frame.querySelectorAll(":scope > .jcard").forEach((el, i) => {
    if (!jobs[i]) return;
    el.style.left = jobs[i].x - b.x + "px";
    el.style.top = jobs[i].y - b.y + "px";
  });
}

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
  const c = dragClusterAt(e.target, el);
  if (!c) return;
  const key = clusterKeyOf(c);
  e.preventDefault();
  if (e.shiftKey) {
    if (SELECTED.has(key)) SELECTED.delete(key); else SELECTED.add(key);
    paintSelection();
    return;
  }
  if (!SELECTED.has(key)) selectOnly(c);
  const mode = dragModeOf(e.target, el);
  const id = el && (el.dataset.id || el.dataset.ghost);
  const d = { mode, id, owner: c, sx: e.clientX, sy: e.clientY, moved: false, dx: 0, dy: 0,
    grip: el || e.target.closest(".cluster .ch") };
  if (mode === "card") {
    d.frame = frameOf(c);
    d.items = [itemOf(el)];
    d.restore = [...d.items, ...(d.frame ? [d.frame, ...d.frame.querySelectorAll(":scope > .jcard")].map(itemOf) : [])];
    d.rect = geo.get(id);
    d.skip = (o) => o === c;
  } else if (mode === "big") {
    d.items = d.restore = [itemOf(el)];
    d.rect = SATS.get(id);
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
    // 첫 유효 이동 직전 상태를 이력으로 잡아 둔다.
    d.snap = layoutSnapshot(d.mode === "card" ? { manual: [cardManualKeyOf(d.id)] }
      : d.mode === "big" ? { big: [d.id] } : clusterKeys(d.list));
  }
  const snap = snapDelta(d.rect, dx, dy, d.skip || (() => false));
  d.dx = snap.dx;
  d.dy = snap.dy;
  for (const it of d.items) {
    it.el.style.left = it.left + snap.dx + "px";
    it.el.style.top = it.top + snap.dy + "px";
  }
  if (d.mode === "card") previewFrame(d, snap.dx, snap.dy);
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
  if (d.mode === "card") {
    const g = geo.get(d.id);
    if (g) MANUAL[cardManualKeyOf(d.id)] = { x: g.x + d.dx, y: g.y + d.dy };
  } else if (d.mode === "big") {
    BIGPOS.set(d.id, { x: d.rect.x + d.dx, y: d.rect.y + d.dy, w: d.rect.w, h: d.rect.h });
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
