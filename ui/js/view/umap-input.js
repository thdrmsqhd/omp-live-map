/* omp-live-map · view · 관제 벽 입력.
   벽: 빈 곳(타일 사이) 끌기·휠 = 벽 이동, Ctrl+휠 = 확대·축소(보통은 필요 없다). 타일 머리 끌기 = 타일 순서 바꾸기(격자 칸에 맞춰 저장),
   오른쪽 아래 모서리 끌기 = 타일 크기(격자 칸 단위로 맞춰 저장), 머리 두 번 누르기 = 그 프로젝트 전체 화면(Esc = 같은 스크롤 자리의 벽으로).
   타일 안: 휠·빈 곳 끌기 = 그 타일만 스크롤, 카드 끌기 = 그 카드만 옮겨 두기(그 타일 캔버스 기준 저장), 누르기 = 서랍·메뉴, 에이전트 두 번 누르기 = 세션 전체 화면.
   키: + − 0(전체 보기) 1, Enter(마지막으로 만진 타일 전체 화면 — 단추·카드 제목에 포커스가 있으면 그 단추), Esc, Alt+I(개입 필요), Alt+T(＋ Task), Alt+L(라이브러리), ?(도움말). */

let umapDrag = null, umapSuppress = 0;
// 화면 좌표 → 벽 좌표(px, 100%).
const umapWorld = (clientX, clientY) => {
  const rect = $("umap-viewport").getBoundingClientRect();
  return { x: (clientX - rect.left - UM.view.x) / UM.view.k, y: (clientY - rect.top - UM.view.y) / UM.view.k };
};
// 벽이 화면 밖으로 날아가지 않게: 폭이 남으면 가운데, 세로는 맨 위 ~ 맨 아래까지만. 전체 화면 타일은 늘 제자리 100%.
function umapClampView() {
  if (UM.focus) { UM.view = { x: 0, y: 0, k: 1 }; return; }
  const rect = $("umap-viewport").getBoundingClientRect(), k = UM.view.k;
  const w = UMAP_WALL_PX.width * k, h = UMAP_WALL_PX.height * k;
  UM.view.x = w <= rect.width ? Math.round((rect.width - w) / 2) : Math.min(0, Math.max(rect.width - w, UM.view.x));
  UM.view.y = h <= rect.height ? 0 : Math.min(0, Math.max(rect.height - h, UM.view.y));
}
function umapZoomTo(k, at) {
  if (UM.focus) return;
  const rect = $("umap-viewport").getBoundingClientRect();
  const px = at ? at.x - rect.left : rect.width / 2, py = at ? at.y - rect.top : rect.height / 2;
  const next = Math.min(2, Math.max(0.2, k));
  UM.view = { x: px - (px - UM.view.x) * (next / UM.view.k), y: py - (py - UM.view.y) * (next / UM.view.k), k: next };
  umapClampView();
  umapApplyView();
}
// 전체 보기(전체 보기 단추·키 0): 벽 전체가 화면에 들어오게(벽은 이미 화면 폭에 맞춰져 있어 보통 100% 그대로, 넘칠 때만 줄인다).
// initial: 열 때·필터를 바꿀 때는 맨 위 100% 로 둔다.
function umapFit(initial = false) {
  if (UM.focus) { if (!initial) return; UM.focus = ""; UM.focusReturn = null; paintUmap(true); }
  const rect = $("umap-viewport").getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  UM.view = initial ? { x: 0, y: 0, k: 1 } : { ...umapFitView(UMAP_WALL_PX, rect, { max: 1, min: 0.3, pad: 0 }), y: 0 };
  umapClampView();
  umapApplyView();
}
const umapBodyOf = (key) => $("umap-items").querySelector(`.um-tile-body[data-body="${CSS.escape(key)}"]`);
const umapFlash = (el) => { if (el) { el.classList.remove("um-flash"); void el.offsetWidth; el.classList.add("um-flash"); } };
// 상자 하나가 보이게: 그 타일이 화면에 들어오게 벽을 옮기고, 타일 본문을 그 상자까지 스크롤한다(flash 면 상자와 타일을 반짝인다).
function umapReveal(box, flash) {
  if (UM.focus && UM.focus !== box.band) umapLeaveFocus();
  const entry = UMAP_TILES.get(box.band);
  if (!entry) return;
  if (!UM.focus) {
    const rect = $("umap-viewport").getBoundingClientRect(), k = UM.view.k, r = entry.rect;
    const top = r.y * k + UM.view.y, bottom = top + r.h * k;
    if (top < 0 || bottom > rect.height) UM.view.y = 8 - r.y * k;
    umapClampView();
    umapApplyView();
  }
  const body = umapBodyOf(box.band);
  if (body) {
    body.scrollTop = Math.max(0, box.y - 12);
    body.scrollLeft = box.x + box.w > body.clientWidth ? Math.max(0, box.x - 12) : 0;
    UM.scroll.set(body.dataset.scroll, { top: body.scrollTop, left: body.scrollLeft });
  }
  if (!flash) return;
  umapFlash($("umap-items").querySelector(`[data-key="${CSS.escape(box.key)}"]`));
  umapFlash($("umap-items").querySelector(`.um-tile[data-band="${CSS.escape(box.band)}"]`));
}
const umapBandOf = (el) => UMAP_BANDS.find(({ key }) => key === (el.closest("[data-band]")?.dataset.band || UMAP_LAYOUT?.boxes[el.dataset.key]?.band));
const umapBandByKey = (key) => UMAP_BANDS.find((band) => band.key === key);

// 프로젝트 전체 화면: 같은 내용을 화면 전체 폭으로(넓은 배치). 들어갈 때의 벽 위치·타일 스크롤은 그대로 남겨 두었다가 Esc 로 돌아온다.
function umapEnterFocus(key, { edit = false } = {}) {
  if (!UMAP_TILES.has(key) && !UMAP_BANDS.some((band) => band.key === key)) return;
  if (!UM.focus) UM.focusReturn = { ...UM.view };
  UM.focus = key;
  UM.current = key;
  UM.focusForEdit = edit;
  UM.view = { x: 0, y: 0, k: 1 };
  paintUmap(true);
}
function umapLeaveFocus() {
  if (!UM.focus) return;
  UM.focus = "";
  UM.focusForEdit = false;
  UM.view = UM.focusReturn || { x: 0, y: 0, k: 1 };
  UM.focusReturn = null;
  paintUmap(true);
}
// Workflow 편집은 프로젝트 전체 화면(넓은 배치: 단계가 옆으로 늘어서 ＋·끌기 자리가 분명하다)에서 한다. 타일에서 시작하면 전체 화면으로 열고, 끝내면 벽으로 돌아온다.
function umapBeginEdit(taskId) {
  const band = UMAP_BANDS.find((item) => item.tasks.some((task) => task.id === taskId));
  if (band && UM.focus !== band.key) umapEnterFocus(band.key, { edit: true });
  umapStartEdit(taskId);
  paintUmap(true);
  const box = UMAP_LAYOUT?.boxes[umapTaskKey(taskId)];
  if (box) umapReveal(box); // 편집하는 Task 줄이 보이게
}
function umapEndEdit() {
  const back = UM.focusForEdit;
  umapStopEdit();
  if (back) umapLeaveFocus();
}

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
    const target = event.target, at = { x: event.clientX, y: event.clientY, moved: false };
    const resize = target.closest("[data-tile-resize]");
    if (resize) {
      const tile = resize.closest(".um-tile");
      umapDrag = { kind: "resize", el: tile, key: tile.dataset.band, w: tile.offsetWidth, h: tile.offsetHeight, ...at };
      return;
    }
    if (target.closest("button, input, textarea, select, a, .inline-edit")) return;
    const card = target.closest(".um-card");
    if (card && card.dataset.key) {
      const box = UMAP_LAYOUT.boxes[card.dataset.key];
      if (box) umapDrag = { kind: "card", el: card, box, ...at };
      return;
    }
    const head = target.closest(".um-tile-head");
    if (head) { if (!UM.focus) umapDrag = { kind: "tile", el: head.closest(".um-tile"), key: head.closest(".um-tile").dataset.band, ...at }; return; }
    const body = target.closest(".um-tile-body");
    if (body) { umapDrag = { kind: "scroll", body, top: body.scrollTop, left: body.scrollLeft, ...at }; return; }
    if (target.closest(".um-tile")) return;
    umapDrag = { kind: "pan", vx: UM.view.x, vy: UM.view.y, ...at };
  });
  viewport.addEventListener("pointermove", (event) => {
    const drag = umapDrag;
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y, k = UM.view.k;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    // 움직이기 시작한 뒤에만 포인터를 잡는다(그냥 누르기는 카드의 click 으로 간다).
    if (!drag.moved) { try { viewport.setPointerCapture(event.pointerId); } catch { /* 이미 끝난 포인터 */ } }
    drag.moved = true;
    if (drag.kind === "pan") { UM.view.x = drag.vx + dx; UM.view.y = drag.vy + dy; umapClampView(); umapApplyView(); viewport.classList.add("panning"); return; }
    if (drag.kind === "scroll") { drag.body.scrollTop = drag.top - dy / k; drag.body.scrollLeft = drag.left - dx / k; return; }
    if (drag.kind === "tile") { drag.el.classList.add("dragging"); drag.el.style.transform = `translate(${dx / k}px,${dy / k}px)`; return; }
    if (drag.kind === "resize") {
      drag.el.classList.add("resizing");
      drag.el.style.width = Math.max(UMAP_GRID.unitW / 2, drag.w + dx / k) + "px";
      drag.el.style.height = Math.max(UMAP_GRID.unitH, drag.h + dy / k) + "px";
      return;
    }
    drag.el.classList.add("dragging");
    drag.el.style.left = drag.box.x + dx / k + "px";
    drag.el.style.top = drag.box.y + dy / k + "px";
  });
  const finish = (event) => {
    const drag = umapDrag;
    umapDrag = null;
    viewport.classList.remove("panning");
    if (!drag || !drag.moved) { if (umapPending) paintUmapSoon(); return; }
    umapSuppress = Date.now() + 250;
    const k = UM.view.k, dx = (event.clientX - drag.x) / k, dy = (event.clientY - drag.y) / k;
    if (drag.kind === "pan" || drag.kind === "scroll") { if (umapPending) paintUmapSoon(); return; }
    if (drag.kind === "tile") {
      // 타일을 놓은 칸(머리 가운데 기준) → 새 순서. 그 순서를 저장한다(되돌리기: 자동 배치로 되돌리기).
      const entry = UMAP_TILES.get(drag.key);
      const keys = umapWallDrop(UMAP_PACK, drag.key, entry.rect.x + Math.min(entry.rect.w / 2, 120) + dx, entry.rect.y + 20 + dy, UMAP_GRID);
      umapWallSetOrder(keys);
      return paintUmap(true);
    }
    if (drag.kind === "resize") { umapWallSetSize(drag.key, umapWallSnap(drag.w + dx, drag.h + dy, UMAP_GRID)); return paintUmap(true); }
    const x = drag.box.x + dx, y = drag.box.y + dy, el = drag.el;
    if (UM.edit && el.classList.contains("editing")) { umapDropStage(el.dataset.task, el.dataset.node, x, y); return; }
    umapSetManual(drag.box.key, drag.box.band, x, y);
    paintUmap(true);
  };
  viewport.addEventListener("pointerup", finish);
  viewport.addEventListener("pointercancel", finish);
  viewport.addEventListener("wheel", (event) => {
    if (event.target.closest(".um-add-line, .inline-menu")) return;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); umapZoomTo(UM.view.k * Math.exp(-event.deltaY * scale * 0.002), { x: event.clientX, y: event.clientY }); return; }
    const tile = event.target.closest(".um-tile"), body = tile?.querySelector(".um-tile-body");
    // 타일 위의 휠은 그 타일만 굴린다(본문은 브라우저 스크롤 그대로, 머리 위에서는 본문을 대신 굴린다).
    if (body && body.contains(event.target)) return;
    event.preventDefault();
    if (body) { body.scrollTop += event.deltaY * scale; body.scrollLeft += event.deltaX * scale; return; }
    UM.view.x -= (event.shiftKey ? event.deltaY : event.deltaX) * scale;
    if (!event.shiftKey) UM.view.y -= event.deltaY * scale;
    umapClampView();
    umapApplyView();
  }, { passive: false });
  items.addEventListener("click", (event) => {
    if (Date.now() < umapSuppress) return;
    void umapClick(event).catch((error) => umapToast(error.message));
  });
  items.addEventListener("dblclick", (event) => {
    const head = event.target.closest(".um-tile-head");
    if (!head || event.target.closest("button, input, select, textarea, .inline-edit")) return;
    const key = head.closest(".um-tile").dataset.band;
    if (UM.focus === key) umapLeaveFocus(); else umapEnterFocus(key);
  });
  items.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".um-agent[data-node]");
    if (!card) return;
    event.preventDefault();
    umapSessionMenu(card);
  });
  bindUmapAddLine(items);
  addEventListener("keydown", umapKey, true);
  addEventListener("resize", () => paintUmapSoon());
}

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
  // 포커스가 단추·링크에 있으면 Enter·Space 는 그 단추의 것이다(카드 제목 단추로 서랍을 연다).
  if ((event.key === "Enter" || event.key === " ") && event.target?.closest?.("button, a, [role=button], summary")) return;
  const stop = () => { event.preventDefault(); event.stopPropagation(); };
  if (event.key === "+" || event.key === "=") { stop(); umapZoomTo(UM.view.k * 1.2); }
  else if (event.key === "-" || event.key === "_") { stop(); umapZoomTo(UM.view.k / 1.2); }
  else if (event.key === "0") { stop(); umapFit(); }
  else if (event.key === "1") { stop(); umapZoomTo(1); }
  else if (event.key === "Enter" && !UM.focus && UM.current && UMAP_TILES.has(UM.current)) { stop(); umapEnterFocus(UM.current); }
  else if (event.key === "?") { stop(); openHelpDrawer(); }
  else if (event.key === "Escape") {
    if (document.querySelector(".inline-menu")) return;
    if (!$("umap-drawer").hidden) { stop(); closeUmapDrawer(); }
    else if (UM.edit) { stop(); umapEndEdit(); }
    else if (UM.adding) { stop(); umapCloseAdd(); }
    else if (UM.focus) { stop(); umapLeaveFocus(); }
  }
}

// 맵 위에 뜨는 알림 한 줄(#umap-status). action({ label, run })을 주면 그 단추(예: '되돌리기')를 붙이고 10초 동안 남긴다.
function umapToast(text, action = null) {
  const status = $("umap-status");
  if (!status) return;
  status.replaceChildren(text);
  if (action) {
    const button = umEl("button", { type: "button", className: "um-toast-act", textContent: action.label,
      onclick: () => { clearTimeout(umapToast.timer); status.replaceChildren(); action.run(); } });
    status.append(" ", button);
  }
  clearTimeout(umapToast.timer);
  umapToast.timer = setTimeout(() => status.replaceChildren(), action ? 10000 : 5000);
}
