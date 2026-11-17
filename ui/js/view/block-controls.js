/* omp-live-map · view · 블록 조작(접기·순서 끌기·높이 끌기) — #nodes 위임 리스너 */

// 블록 상단 ⋮⋮ 핸들: 같은 컬럼 안에서 DOM 을 직접 옮기고, 놓으면 순서를 저장한다.
function dragBlockOrder(e, grip) {
  const blk = grip.closest(".blk");
  const col = blk && blk.parentElement;
  const card = blk && blk.closest(".node[data-id]");
  if (!col || !card) return;
  e.preventDefault();
  // 옮겨지는 블록 대신 고정된 컬럼이 포인터를 잡아야 이동 중에 캡처가 풀리지 않는다.
  col.setPointerCapture(e.pointerId);
  blk.classList.add("bmoving");
  const move = (ev) => {
    const sibs = [...col.children].filter((x) => x !== blk && x.classList.contains("blk") && !x.hidden);
    const before = sibs.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    if (before) { if (blk.nextElementSibling !== before) col.insertBefore(blk, before); }
    else if (col.lastElementChild !== blk) col.appendChild(blk);
  };
  const done = () => {
    col.removeEventListener("pointermove", move);
    col.removeEventListener("pointerup", done);
    col.removeEventListener("pointercancel", done);
    blk.classList.remove("bmoving");
    const u = cardUI(card.dataset.id);
    const slot = blk.dataset.slot === "side" ? "side" : "main";
    const now = [...col.children].filter((x) => x.classList.contains("blk")).map((x) => x.dataset.bkey || x.dataset.blk);
    // 이 카드에서 빠진 블록의 예전 순서는 뒤에 보존한다.
    u.order[slot] = [...now, ...u.order[slot].filter((t) => !now.includes(t))];
    saveCardUI();
    // DOM 순서가 이미 저장한 순서와 같다. 서명만 맞춰 바디를 유지한다.
    syncBodySig(card);
    renderMap(false, true);
  };
  col.addEventListener("pointermove", move);
  col.addEventListener("pointerup", done);
  col.addEventListener("pointercancel", done);
}

// 블록 하단 4px 구분선: 세로로 끌어 px 높이를 정한다(줌 배율 보정).
function dragBlockHeight(e, bar) {
  const blk = bar.closest(".blk");
  const card = blk && blk.closest(".node[data-id]");
  if (!card) return;
  e.preventDefault();
  bar.setPointerCapture(e.pointerId);
  const k = view.k || 1;
  const sy = e.clientY;
  const startH = blk.getBoundingClientRect().height / k;
  let h = 0;
  const move = (ev) => {
    h = Math.round(Math.min(BLOCK_H_MAX, Math.max(BLOCK_H_MIN, startH + (ev.clientY - sy) / k)));
    blk.classList.add("sized");
    blk.style.flex = "0 0 auto";
    blk.style.height = h + "px";
  };
  const done = () => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", done);
    bar.removeEventListener("pointercancel", done);
    if (!h) return;   // 움직임 없는 클릭(더블클릭의 일부)은 저장하지 않는다.
    cardUI(card.dataset.id).h[blk.dataset.bkey || blk.dataset.blk] = h;
    saveCardUI();
    // 끌면서 맞춘 인라인 스타일이 저장값과 같다. 서명만 맞춰 바디를 유지한다.
    syncBodySig(card);
    renderMap(false, true);
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", done);
  bar.addEventListener("pointercancel", done);
}

// 블록 DOM 을 직접 고친 뒤, 바디 서명을 현재 저장 상태에 맞춘다(다음 렌더에서 재생성 방지).
function syncBodySig(card) {
  const n = nodeById(card.dataset.id);
  const body = card.querySelector(":scope > .body");
  if (n && body) body.dataset.sig = blockSig(n);
}

(function bindBlockControls() {
  const box = $("nodes");
  box.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest("button[data-bgrip]");
    if (grip) return dragBlockOrder(e, grip);
    const bar = e.target.closest("button[data-bresize]");
    if (bar) return dragBlockHeight(e, bar);
  });
  box.addEventListener("click", (e) => {
    const chev = e.target.closest("button[data-bchev]");
    const card = chev && chev.closest(".node[data-id]");
    if (!card) return;
    const u = cardUI(card.dataset.id);
    const t = chev.dataset.bchev;
    if (u.collapsed[t]) delete u.collapsed[t]; else u.collapsed[t] = true;
    saveCardUI();
    renderMap(false, true);
  });
  box.addEventListener("dblclick", (e) => {
    const bar = e.target.closest("button[data-bresize]");
    const card = bar && bar.closest(".node[data-id]");
    if (!card) return;
    delete cardUI(card.dataset.id).h[bar.dataset.bresize];
    saveCardUI();
    renderMap(false, true);
  });
})();
