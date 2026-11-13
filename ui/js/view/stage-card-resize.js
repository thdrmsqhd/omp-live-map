/* omp-live-map · view · 서브카드 크기 조절 (오른쪽 아래 손잡이, 카드별 저장) */
// 작은 서브카드 크기는 SUBSIZE, 열린 서브카드 크기는 BIGPOS w/h 에 저장한다. 메인 카드는 손잡이가 없다.

const SUB_MIN = { w: 180, h: 96 };
const SUB_BIG_MIN = { w: 380, h: 280 };

const resizeGrip = () => '<i class="rsz" title="끌어서 크기 조절 · 더블클릭으로 원래대로"></i>';

function bindCardResize() {
  const box = $("nodes");
  let rs = null;

  box.addEventListener("pointerdown", (e) => {
    const grip = e.button === 0 && !spaceDown && e.target.closest(".rsz");
    if (!grip) return;
    const el = grip.closest(".node");
    const id = el && el.dataset.id;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const big = el.classList.contains("big");
    if (!big) el.classList.add("sized");
    rs = { el, id, big, sx: e.clientX, sy: e.clientY, w: el.offsetWidth, h: el.offsetHeight,
      min: big ? SUB_BIG_MIN : SUB_MIN, nw: el.offsetWidth, nh: el.offsetHeight };
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
    pushHistory(layoutSnapshot(d.big ? { big: [d.id] } : { size: [d.id] }));
    if (d.big) {
      const b = BIGPOS.get(d.id);
      if (b) BIGPOS.set(d.id, { ...b, w: d.nw, h: d.nh });
      saveOpenCards();
    } else {
      // smallCard 는 높이를 g.h - 3 으로 그리므로 저장값에 되돌려 넣는다.
      SUBSIZE.set(d.id, { w: d.nw, h: d.nh + 3 });
      saveSubSizes();
    }
    suppressClickUntil = Date.now() + 300;
    renderMap(false, true);
  };
  box.addEventListener("pointerup", finish);
  box.addEventListener("pointercancel", finish);

  box.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".rsz") && e.target.closest(".node");
    if (!el || !el.dataset.id) return;
    const id = el.dataset.id;
    // 기본 크기 복원도 크기 조절과 같은 이력에 넣는다.
    pushHistory(layoutSnapshot(el.classList.contains("big") ? { big: [id] } : { size: [id] }));
    if (el.classList.contains("big")) {
      const b = BIGPOS.get(id);
      if (b) BIGPOS.set(id, { ...b, w: BIG_W, h: BIG_H });
      saveOpenCards();
    } else if (SUBSIZE.delete(id)) saveSubSizes();
    renderMap(false, true);
  });
}
