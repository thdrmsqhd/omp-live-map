/* omp-live-map · view · 스파크라인 크로스헤어 (#nodes 위임 리스너, 로드 시 1회) */
// 카드 svg 는 렌더마다 새로 생기므로 상태를 DOM 에 두지 않는다.

function clearSparkTip() {
  const box = $("nodes");
  box.querySelectorAll(":scope > .sparktip").forEach((el) => el.remove());
  box.querySelectorAll("svg[data-pts] .sp-xh").forEach((el) => el.remove());
}

function sparkHover(ev) {
  const box = $("nodes");
  const svg = ev.target.closest ? ev.target.closest("svg[data-pts]") : null;
  if (!svg) { clearSparkTip(); return; }
  let pts;
  try { pts = JSON.parse(svg.dataset.pts); } catch { return; }
  if (!pts || pts.length < 2) return;
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const w = vb.width, h = vb.height;
  const i = Math.max(0, Math.min(pts.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (pts.length - 1))));
  const p = pts[i];
  const max = +svg.dataset.max || 1;
  const x = (i * w) / (pts.length - 1);
  const y = h - 2 - (p.out / max) * (h - 4);
  box.querySelectorAll("svg[data-pts] .sp-xh").forEach((el) => { if (el.ownerSVGElement !== svg) el.remove(); });
  let g = svg.querySelector(".sp-xh");
  if (!g) {
    const NS = "http://www.w3.org/2000/svg";
    g = document.createElementNS(NS, "g");
    g.setAttribute("class", "sp-xh");
    g.appendChild(document.createElementNS(NS, "line"));
    g.appendChild(document.createElementNS(NS, "circle"));
    svg.appendChild(g);
  }
  const [line, dot] = g.children;
  line.setAttribute("x1", x); line.setAttribute("x2", x);
  line.setAttribute("y1", 0); line.setAttribute("y2", h);
  dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", 2.6);
  let tip = box.querySelector(":scope > .sparktip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "sparktip";
    box.appendChild(tip);
  }
  tip.textContent = `턴 ${i + 1}/${pts.length} · 출력 ${fmt(p.out)} · ${ago(p.ts)}${p.dur ? ` · ${(p.dur / 1000).toFixed(1)}초 소요` : ""}`;
  // #nodes 는 #wrapper 의 scale(view.k) 안에 있으므로 화면 좌표를 맵 좌표로 되돌린다.
  const b = box.getBoundingClientRect();
  const k = view.k || 1;
  tip.style.left = `${(ev.clientX - b.left) / k + 10}px`;
  tip.style.top = `${(r.top - b.top) / k - 22}px`;
}

$("nodes").addEventListener("pointermove", sparkHover);
$("nodes").addEventListener("pointerleave", clearSparkTip);
