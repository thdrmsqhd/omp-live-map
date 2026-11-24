/* omp-live-map · view · 큰 카드 크기 조절 (오른쪽 아래 손잡이, 카드별 저장) */
// 열린 카드 크기는 BIGPOS w/h 에 저장한다. 메인·서브 큰 카드 모두 손잡이가 있다.

const SUB_BIG_MIN = { w: 380, h: 280 };

const resizeGrip = () => '<i class="rsz" title="끌어서 크기 조절 · 더블클릭으로 원래대로"></i>';

function bindCardResize() {
  const box = $("nodes");
  let rs = null;

  box.addEventListener("pointerdown", (e) => {
    const grip = mapMode === "map" && e.button === 0 && !spaceDown && e.target.closest(".rsz");
    if (!grip) return;
    const el = grip.closest(".node.big");
    const id = el && el.dataset.id;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    rs = { el, id, sx: e.clientX, sy: e.clientY, w: el.offsetWidth, h: el.offsetHeight,
      min: SUB_BIG_MIN, nw: el.offsetWidth, nh: el.offsetHeight };
    DEFER = true;
  });

  box.addEventListener("pointermove", (e) => {
    if (!rs) return;
    rs.nw = Math.round(Math.max(rs.min.w, rs.w + (e.clientX - rs.sx) / view.k));
    rs.nh = Math.round(Math.max(rs.min.h, rs.h + (e.clientY - rs.sy) / view.k));
    rs.el.style.width = rs.nw + "px";
    rs.el.style.height = rs.nh + "px";
    scheduleEdges();
  });

  const finish = () => {
    if (!rs) return;
    const d = rs;
    rs = null;
    DEFER = false;
    if (d.nw === d.w && d.nh === d.h) return;
    pushHistory(layoutSnapshot({ big: [d.id] }));
    const b = BIGPOS.get(d.id);
    if (b) BIGPOS.set(d.id, { ...b, w: d.nw, h: d.nh });
    saveOpenCards();
    suppressClickUntil = Date.now() + 300;
    renderMap(false, true);
  };
  box.addEventListener("pointerup", finish);
  const cancel = () => {
    if (!rs) return;
    const d = rs;
    rs = null;
    DEFER = false;
    d.el.style.width = d.w + "px";
    d.el.style.height = d.h + "px";
    scheduleEdges();
    renderMap(false, true);
  };
  box.addEventListener("pointercancel", cancel);
  addEventListener("keydown", (e) => {
    if (!rs || e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel();
  }, true);

  box.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".rsz") && e.target.closest(".node.big");
    if (!el || !el.dataset.id) return;
    const id = el.dataset.id;
    // 기본 크기 복원도 크기 조절과 같은 이력에 넣는다.
    pushHistory(layoutSnapshot({ big: [id] }));
    const b = BIGPOS.get(id);
    if (b) BIGPOS.set(id, { ...b, w: BIG_W, h: BIG_H });
    saveOpenCards();
    renderMap(false, true);
  });
}
