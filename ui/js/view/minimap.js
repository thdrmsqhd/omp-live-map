/* omp-live-map · view · 미니맵 그리기와 클릭·끌기 이동 */

function paintMinimap() {
  const svg = $("mmsvg");
  const W = 204, H = 142, pad = 6;
  const b = boundsOf(allBoxes());
  if (!b) { svg.innerHTML = ""; return; }
  const k = Math.min((W - pad * 2) / Math.max(1, b.w), (H - pad * 2) / Math.max(1, b.h));
  const ox = pad + ((W - pad * 2) - b.w * k) / 2 - b.x * k;
  const oy = pad + ((H - pad * 2) - b.h * k) / 2 - b.y * k;
  MM = { k, ox, oy };
  const R = (r, cls) => `<rect class="${cls}" x="${(r.x * k + ox).toFixed(1)}" y="${(r.y * k + oy).toFixed(1)}" width="${Math.max(1.5, r.w * k).toFixed(1)}" height="${Math.max(1.5, r.h * k).toFixed(1)}" rx="1"/>`;
  const st = $("stage").getBoundingClientRect();
  svg.innerHTML = [
    ...CLUSTERS.map((c) => R(c, "mm-cl")),
    ...[...geo.values()].map((g) => R(g, "mm-c")),
    ...[...SATS.values()].map((box) => R(box, "mm-sat")),
    R({ x: -view.x / view.k, y: -view.y / view.k, w: st.width / view.k, h: st.height / view.k }, "mm-view"),
  ].join("");
}

function miniToWorld(e) {
  const r = $("minimap").getBoundingClientRect();
  return { x: (e.clientX - r.left - MM.ox) / MM.k, y: (e.clientY - r.top - MM.oy) / MM.k };
}

function centerOn(wx, wy) {
  const st = $("stage").getBoundingClientRect();
  view.x = st.width / 2 - wx * view.k;
  view.y = st.height / 2 - wy * view.k;
  applyView();
}

function bindMinimap() {
  const mm = $("minimap");
  let drag = false;
  const go = (e) => { const p = miniToWorld(e); centerOn(p.x, p.y); };
  mm.addEventListener("pointerdown", (e) => {
    drag = true;
    stopMomentum();
    mm.setPointerCapture(e.pointerId);
    go(e);
  });
  mm.addEventListener("pointermove", (e) => { if (drag) go(e); });
  mm.addEventListener("pointerup", () => { drag = false; });
  mm.addEventListener("pointercancel", () => { drag = false; });
}
