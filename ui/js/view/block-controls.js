/* 블록 포인터 조작: 미리보기 → 확정 / 취소. UI 상태는 카드별로 보관한다. */
let cancelBlockGesture = null;

function blockColumnAt(card, x, y) {
  const target = document.elementFromPoint(x, y)?.closest(".col-main,.col-ed,.col-tree,.col-left");
  return target && card.contains(target) ? target : null;
}
const blockColumnSlot = (col) => col.classList.contains("col-ed") ? "edit" :
  col.classList.contains("col-tree") ? "side" : col.classList.contains("col-left") ? "left" : "main";

function runBlockGesture(event, capture, move, commit, rollback) {
  if (cancelBlockGesture) cancelBlockGesture();
  const pointer = event.pointerId;
  let ended = false;
  const finish = (cancelled) => {
    if (ended) return;
    ended = true;
    capture.removeEventListener("pointermove", onMove);
    capture.removeEventListener("pointerup", onUp);
    capture.removeEventListener("pointercancel", onCancel);
    capture.removeEventListener("lostpointercapture", onCancel);
    cancelBlockGesture = null;
    if (capture.hasPointerCapture(pointer)) capture.releasePointerCapture(pointer);
    if (cancelled) rollback(); else commit();
    DEFER = false;
    renderMap(false, true);
  };
  const onMove = (e) => { if (e.pointerId === pointer) move(e); };
  const onUp = (e) => { if (e.pointerId === pointer) finish(false); };
  const onCancel = (e) => { if (e.pointerId === pointer) finish(true); };
  cancelBlockGesture = () => finish(true);
  DEFER = true;
  capture.setPointerCapture(pointer);
  capture.addEventListener("pointermove", onMove);
  capture.addEventListener("pointerup", onUp);
  capture.addEventListener("pointercancel", onCancel);
  capture.addEventListener("lostpointercapture", onCancel);
}

function dragBlockOrder(e, grip) {
  const blk = grip.closest(".blk"), col = blk?.parentElement, card = blk?.closest(".node[data-id]");
  if (!card || !col) return;
  e.preventDefault();
  const originalNext = blk.nextElementSibling;
  const start = { x: e.clientX, y: e.clientY };
  const id = card.dataset.id, key = blk.dataset.bkey;
  const snap = layoutSnapshot({ ui: [id] });
  let target = col, before = originalNext, moved = false;
  blk.classList.add("bmoving");
  const clear = () => {
    blk.classList.remove("bmoving");
    card.querySelectorAll(".block-drop").forEach((x) => x.classList.remove("block-drop"));
  };
  // 미리보기에는 iframe·편집기 DOM을 옮기지 않는다. 확정 때만 블록을 이동한다.
  runBlockGesture(e, card, (ev) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
    moved = true;
    const next = blockColumnAt(card, ev.clientX, ev.clientY);
    if (!next) return;
    target.classList.remove("block-drop");
    target = next;
    target.classList.add("block-drop");
    before = [...target.children].filter((x) => x !== blk && x.classList.contains("blk"))
      .find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }) || null;
  }, () => {
    clear();
    if (!moved || (target === col && before === originalNext)) return;
    const u = cardUI(id), slot = blockColumnSlot(target);
    const order = [...target.children].filter((x) => x !== blk && x.classList.contains("blk")).map((x) => x.dataset.bkey);
    const i = before ? order.indexOf(before.dataset.bkey) : order.length;
    order.splice(i < 0 ? order.length : i, 0, key);
    u.slots[key] = slot;
    u.order[slot] = [...order, ...(u.order[slot] || []).filter((x) => !order.includes(x))];
    pushHistory(snap);
    saveCardUI();
  }, clear);
}

function dragBlockHeight(e, bar) {
  const blk = bar.closest(".blk"), card = blk?.closest(".node[data-id]");
  if (!card || blk.classList.contains("collapsed")) return;
  e.preventDefault();
  const k = card.getBoundingClientRect().width / card.offsetWidth || 1;
  const sy = e.clientY, startH = blk.getBoundingClientRect().height / k;
  const css = blk.style.cssText, cls = blk.className;
  const id = card.dataset.id, key = blk.dataset.bkey;
  let h = 0;
  runBlockGesture(e, bar, (ev) => {
    if (!h && Math.abs(ev.clientY - sy) < 3) return;
    h = Math.round(Math.min(BLOCK_H_MAX, Math.max(BLOCK_H_MIN, startH + (ev.clientY - sy) / k)));
    blk.classList.add("sized"); blk.style.flex = "0 0 auto"; blk.style.height = h + "px";
  }, () => {
    if (!h) return;
    pushHistory(layoutSnapshot({ ui: [id] }));
    cardUI(id).h[key] = h;
    saveCardUI();
    syncBodySig(card);
  }, () => { blk.style.cssText = css; blk.className = cls; });
}

function syncBodySig(card) {
  const n = nodeById(card.dataset.id), body = card.querySelector(":scope > .body");
  if (n && body) body.dataset.sig = blockSig(n);
}

(function bindBlockControls() {
  const box = $("nodes");
  addEventListener("keydown", (e) => {
    if (!cancelBlockGesture || e.key !== "Escape") return;
    e.preventDefault(); e.stopImmediatePropagation(); cancelBlockGesture();
  }, true);
  box.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || spaceDown) return;
    const grip = e.target.closest("button[data-bgrip]");
    if (grip) return dragBlockOrder(e, grip);
    const bar = e.target.closest("button[data-bresize]");
    if (bar) return dragBlockHeight(e, bar);
  });
  box.addEventListener("change", (e) => {
    const select = e.target.closest("select[data-bslot]"), card = select?.closest(".node[data-id]");
    if (!card || !Object.hasOwn(BLOCK_SLOTS, select.value)) return;
    const id = card.dataset.id;
    pushHistory(layoutSnapshot({ ui: [id] }));
    cardUI(id).slots[select.dataset.bslot] = select.value;
    saveCardUI(); renderMap(false, true);
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button"), card = b?.closest(".node[data-id]");
    if (!card) return;
    const id = card.dataset.id, u = cardUI(id);
    if (b.dataset.bremove) return toggleBlock(id, b.dataset.bremove);
    if (b.dataset.bmax) {
      if (BLOCK_FOCUS.get(id) === b.dataset.bmax) BLOCK_FOCUS.delete(id);
      else {
        BLOCK_FOCUS.set(id, b.dataset.bmax);
        if (u.collapsed[b.dataset.bmax]) { delete u.collapsed[b.dataset.bmax]; saveCardUI(); }
      }
      return renderMap(false, true);
    }
    if (!b.dataset.bchev) return;
    pushHistory(layoutSnapshot({ ui: [id] }));
    const t = b.dataset.bchev;
    if (u.collapsed[t]) delete u.collapsed[t]; else u.collapsed[t] = true;
    if (BLOCK_FOCUS.get(id) === t) BLOCK_FOCUS.delete(id);
    saveCardUI(); renderMap(false, true);
  });
  box.addEventListener("dblclick", (e) => {
    const bar = e.target.closest("button[data-bresize]"), card = bar?.closest(".node[data-id]");
    if (!card) return;
    pushHistory(layoutSnapshot({ ui: [card.dataset.id] }));
    delete cardUI(card.dataset.id).h[bar.dataset.bresize];
    saveCardUI(); renderMap(false, true);
  });
})();
