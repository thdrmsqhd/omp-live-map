/* omp-live-map · view · 한 맵 입력: 빈 곳 끌기 = 이동, 휠 = 이동(Ctrl+휠 = 확대·축소), 카드 끌기 = 그 카드만 옮겨 두기(저장),
   누르기 = 서랍·메뉴, 세션 두 번 누르기 = 세션 전체 화면. 키: + − 0 1, Esc, Alt+I(개입 필요), Alt+T(＋ Task), Alt+L(라이브러리), ?(도움말). */

let umapDrag = null, umapSuppress = 0;
const umapWorld = (clientX, clientY) => {
  const rect = $("umap-viewport").getBoundingClientRect();
  return { x: (clientX - rect.left - UM.view.x) / UM.view.k, y: (clientY - rect.top - UM.view.y) / UM.view.k };
};
function umapZoomTo(k, at) {
  const rect = $("umap-viewport").getBoundingClientRect();
  const px = at ? at.x - rect.left : rect.width / 2, py = at ? at.y - rect.top : rect.height / 2;
  const next = Math.min(2, Math.max(0.2, k));
  UM.view = { x: px - (px - UM.view.x) * (next / UM.view.k), y: py - (py - UM.view.y) * (next / UM.view.k), k: next };
  umapApplyView();
  umapSaveView();
}
function umapFit() {
  if (!UMAP_LAYOUT) return;
  const rect = $("umap-viewport").getBoundingClientRect();
  const k = Math.min(1, Math.max(0.2, Math.min((rect.width - 40) / Math.max(1, UMAP_LAYOUT.width), (rect.height - 70) / Math.max(1, UMAP_LAYOUT.height))));
  UM.view = { x: 20, y: 56, k };
  umapApplyView();
  umapSaveView();
}
// 상자 하나가 화면에 들어오게 옮긴다(배율은 읽을 수 있는 정도로 둔다).
function umapReveal(box, flash) {
  const rect = $("umap-viewport").getBoundingClientRect();
  const k = Math.max(UM.view.k, 0.75);
  // 넓은 상자(＋ Task 한 줄·띠)는 왼쪽에 맞추고, 카드는 가운데로 옮긴다.
  const x = box.w * k > rect.width * 0.5 ? 40 - box.x * k : rect.width / 2 - (box.x + box.w / 2) * k;
  UM.view = { k, x, y: Math.min(rect.height / 2, 160) - box.y * k + 40 };
  umapApplyView();
  umapSaveView();
  if (!flash) return;
  const el = $("umap-items").querySelector(`[data-key="${CSS.escape(box.key)}"]`);
  if (el) { el.classList.remove("um-flash"); void el.offsetWidth; el.classList.add("um-flash"); }
}
const umapBandOf = (el) => UMAP_BANDS.find(({ key }) => key === (el.closest("[data-band]")?.dataset.band || UMAP_LAYOUT?.boxes[el.dataset.key]?.band));
const umapBandByKey = (key) => UMAP_BANDS.find((band) => band.key === key);

function umapOpenSession(id) {
  if (!nodeInData(id)) return;
  UM.returnTo = { ...UM.view };
  setMapMode("workspace", false);
  openNode(id);
}

function bindUmapInput() {
  const viewport = $("umap-viewport"), items = $("umap-items");
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const card = event.target.closest(".um-card");
    if (event.target.closest("button, input, textarea, select, a, .inline-edit")) return;
    if (card && card.dataset.key) {
      const box = UMAP_LAYOUT.boxes[card.dataset.key];
      if (!box) return;
      umapDrag = { kind: "card", el: card, box, x: event.clientX, y: event.clientY, moved: false };
    } else umapDrag = { kind: "pan", x: event.clientX, y: event.clientY, vx: UM.view.x, vy: UM.view.y, moved: false };
  });
  viewport.addEventListener("pointermove", (event) => {
    const drag = umapDrag;
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    // 움직이기 시작한 뒤에만 포인터를 잡는다(그냥 누르기는 카드의 click 으로 간다).
    if (!drag.moved) { try { viewport.setPointerCapture(event.pointerId); } catch { /* 이미 끝난 포인터 */ } }
    drag.moved = true;
    if (drag.kind === "pan") { UM.view.x = drag.vx + dx; UM.view.y = drag.vy + dy; umapApplyView(); viewport.classList.add("panning"); return; }
    drag.el.classList.add("dragging");
    drag.el.style.left = drag.box.x + dx / UM.view.k + "px";
    drag.el.style.top = drag.box.y + dy / UM.view.k + "px";
  });
  const finish = (event) => {
    const drag = umapDrag;
    umapDrag = null;
    viewport.classList.remove("panning");
    if (!drag || !drag.moved) { if (umapPending) paintUmapSoon(); return; }
    umapSuppress = Date.now() + 250;
    if (drag.kind === "pan") { umapSaveView(); if (umapPending) paintUmapSoon(); return; }
    const x = drag.box.x + (event.clientX - drag.x) / UM.view.k, y = drag.box.y + (event.clientY - drag.y) / UM.view.k;
    const el = drag.el;
    if (UM.edit && el.classList.contains("editing")) { umapDropStage(el.dataset.task, el.dataset.node, x); return; }
    const band = UMAP_LAYOUT.bands.find(({ key }) => key === drag.box.band);
    umapSetManual(drag.box.key, drag.box.band, x - band.x, y - band.y);
    paintUmap(true);
  };
  viewport.addEventListener("pointerup", finish);
  viewport.addEventListener("pointercancel", finish);
  viewport.addEventListener("wheel", (event) => {
    if (event.target.closest(".um-add-line, .inline-menu")) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    if (event.ctrlKey || event.metaKey) { umapZoomTo(UM.view.k * Math.exp(-event.deltaY * scale * 0.002), { x: event.clientX, y: event.clientY }); return; }
    UM.view.x -= (event.shiftKey ? event.deltaY : event.deltaX) * scale;
    if (!event.shiftKey) UM.view.y -= event.deltaY * scale;
    umapApplyView();
    clearTimeout(umapInput.wheelSave);
    umapInput.wheelSave = setTimeout(umapSaveView, 300);
  }, { passive: false });
  items.addEventListener("click", (event) => {
    if (Date.now() < umapSuppress) return;
    void umapClick(event).catch((error) => umapToast(error.message));
  });
  items.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".um-sess[data-node]");
    if (!card) return;
    event.preventDefault();
    umapSessionMenu(card);
  });
  bindUmapAddLine(items);
  $("umap-reset").onclick = () => { umapResetAllManual(); paintUmap(true); umapToast("모든 카드를 자동 배치로 되돌렸습니다."); };
  $("umap-fit-all").onclick = umapFit;
  addEventListener("keydown", umapKey, true);
  addEventListener("resize", () => paintUmapSoon());
}
const umapInput = { wheelSave: 0 };

function umapKey(event) {
  if (mapMode !== "map") return;
  const typing = /input|textarea|select/i.test(event.target?.tagName || "") || event.target?.isContentEditable;
  // 서랍 안 입력에서도 Esc 는 서랍을 닫는다(입력은 닫기 전에 저장된다). 제자리 입력·＋ Task 한 줄은 자기 Esc 를 쓴다.
  if (event.key === "Escape" && typing && $("umap-drawer").contains(event.target) && !event.target.classList.contains("inline-edit")) {
    event.preventDefault(); event.stopPropagation(); closeUmapDrawer(); return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "i") { event.preventDefault(); event.stopPropagation(); umapJumpAttention(); return; }
    if (key === "t") { event.preventDefault(); event.stopPropagation(); umapOpenAdd(); return; }
    if (key === "l") { event.preventDefault(); event.stopPropagation(); openLibraryDrawer(); return; }
  }
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  const stop = () => { event.preventDefault(); event.stopPropagation(); };
  if (event.key === "+" || event.key === "=") { stop(); umapZoomTo(UM.view.k * 1.2); }
  else if (event.key === "-" || event.key === "_") { stop(); umapZoomTo(UM.view.k / 1.2); }
  else if (event.key === "0") { stop(); umapFit(); }
  else if (event.key === "1") { stop(); umapZoomTo(1); }
  else if (event.key === "?") { stop(); openHelpDrawer(); }
  else if (event.key === "Escape") {
    if (document.querySelector(".inline-menu")) return;
    if (!$("umap-drawer").hidden) { stop(); closeUmapDrawer(); }
    else if (UM.edit) { stop(); umapStopEdit(); }
    else if (UM.adding) { stop(); umapCloseAdd(); }
  }
}

function umapToast(text) {
  const status = $("umap-status");
  if (!status) return;
  status.textContent = text;
  clearTimeout(umapToast.timer);
  umapToast.timer = setTimeout(() => { status.textContent = ""; }, 5000);
}
