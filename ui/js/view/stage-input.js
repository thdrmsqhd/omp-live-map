/* omp-live-map · view · 스테이지 포인터·휠·키보드 입력 */

// 카드 안에서 자체 동작이 있는 영역. 여기서 시작한 포인터는 카드 끌기·선택·열기로 치지 않는다.
const CARD_INTERACTIVE = "button, input, textarea, .term, .chat, .col-tree, .brow, .bgs, .cmsgs, .cmsg, .tout, .tree, .rename, .rsz";

function bindStageInput() {
  const stage = $("stage");
  let drag = null;

  stage.addEventListener("pointerdown", (e) => {
    const onCard = e.target.closest(".node, .cluster .ch, .jcard");
    const wantPan = e.button === 1 || spaceDown || !onCard;
    if (!wantPan) return;
    if (!onCard && !spaceDown && SELECTED.size) { SELECTED.clear(); paintSelection(); }
    e.preventDefault();
    stopMomentum();
    drag = { x: e.clientX - view.x, y: e.clientY - view.y, lx: e.clientX, ly: e.clientY, lt: performance.now() };
    stage.classList.add("drag");
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lt);
    view.x = e.clientX - drag.x;
    view.y = e.clientY - drag.y;
    velocity.x = (e.clientX - drag.lx) / dt * 16;
    velocity.y = (e.clientY - drag.ly) / dt * 16;
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    drag.lt = now;
    applyView();
  });

  stage.addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null;
    stage.classList.remove("drag");
    if (Math.abs(velocity.x) > 0.6 || Math.abs(velocity.y) > 0.6) momentum();
  });
  stage.addEventListener("pointercancel", () => { drag = null; stage.classList.remove("drag"); });

  // 잡 카드: 누르면 출력을 펼치거나 접는다(끝쪽 따라가기, 위로 올리면 멈춤).
  stage.addEventListener("click", (e) => {
    const card = e.target.closest(".jcard");
    if (!card || String(getSelection()) !== "") return;
    toggleJobCard(card.dataset.job);
  });

  // 피그마식: 카드 더블클릭 = 열기, 미러 카드 더블클릭 = 접기, 클러스터 제목 = 그 클러스터로 확대, 빈 바탕 = 전체 보기.
  stage.addEventListener("dblclick", (e) => {
    const node = e.target.closest(".node");
    if (!node) {
      const head = e.target.closest(".cluster .ch");
      const c = head && clusterByKey(head.parentElement.dataset.ckey);
      if (c) fitBox(c, 26, 220); else if (!head) fit();
      return;
    }
    const id = node.dataset.id;
    if (node.classList.contains("big") && e.target.closest(".chrome .nm")) {
      const n = nodeById(id);
      if (n && (agentKind(n.kind) || n.kind === "local")) { renamingId = id; renderMap(false, true); }
      return;
    }
    if (e.target.closest(CARD_INTERACTIVE)) return;
    if (node.dataset.ghost) return openNode(node.dataset.ghost);
    if (id && !openIds.has(id)) openNode(id);
  });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    stopMomentum();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * scale * 0.002);
      const k = Math.min(2.6, Math.max(0.12, view.k * factor));
      const rect = stage.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      view.x = px - (px - view.x) * (k / view.k);
      view.y = py - (py - view.y) * (k / view.k);
      view.k = k;
    } else {
      const dx = e.shiftKey ? (e.deltaX || e.deltaY) : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      view.x -= dx * scale;
      view.y -= dy * scale;
    }
    applyView();
  }, { passive: false });

  // 카드 안 스크롤 영역 위에서는 휠이 그 영역을 굴리고, 끝에 닿아도 맵을 스크롤·확대·축소하지 않는다.
  $("nodes").addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.target.closest(".tout, .cmsgs, .tree, .bgs, .bgout, .cin, .col-main")) e.stopPropagation();
  }, { passive: true });

  addEventListener("keydown", (e) => {
    // 입력창·contenteditable·터미널 안의 키(Ctrl+Z 포함)는 지도에서 가로채지 않는다.
    const typing = e.target && (/input|textarea/i.test(e.target.tagName) || e.target.isContentEditable || !!(e.target.closest && e.target.closest(".term")));
    if (e.code === "Space" && !e.repeat && !typing) { spaceDown = true; stage.style.cursor = "grab"; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const pt = worldPoint(r.left + r.width / 2 - 120, r.top + r.height / 2 - 60);
      addLocal(pt.x, pt.y);
      return;
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      if (cancelCardDrag() || undoLayout()) e.preventDefault();   // 이동 중이면 되돌리기 대신 이동만 취소한다
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") zoomTo(view.k * 1.25);
    else if (e.key === "-" || e.key === "_") zoomTo(view.k / 1.25);
    else if (e.key === "0") fit();
    else if (e.key === "1") zoomTo(1);
    else if (e.key === "Escape") {
      if (cancelCardDrag()) return;
      if ($("ctxmenu").classList.contains("open")) closeMenu();
      else if (SELECTED.size) { SELECTED.clear(); paintSelection(); }
      else if (openIds.size) { closeCard(); renderMap(false, true); }
    }
  });
  addEventListener("keyup", (e) => {
    if (e.code === "Space") { spaceDown = false; stage.style.cursor = ""; }
  });
}
