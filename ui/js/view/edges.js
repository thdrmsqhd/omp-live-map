/* omp-live-map · view · 카드 사이 관계선 SVG (부모-자식, 잡, 미러↔큰 카드) */
// 선은 #edges(카드 아래 층, z-index 2 < .node 3)에 그리고, 경로는 model/route.js 가 다른 카드를 피해 고른다.
// 카드 사각형은 DOM 의 left/top/width/height 에서 읽는다 — 끌기·크기 조절 중에도 화면 그대로 따라간다.

const curveH = (x1, y1, x2, y2) => { const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };

const styleNum = (el, k) => parseFloat(el.style[k]) || 0;

function styleRect(el, ox, oy) {
  return { x: ox + styleNum(el, "left"), y: oy + styleNum(el, "top"),
    w: styleNum(el, "width") || el.offsetWidth, h: styleNum(el, "height") || el.offsetHeight };
}

// 화면의 카드 사각형: 장애물 전체, 작은 카드(열린 카드는 자리표시 ghost), 큰 카드, 클러스터별 잡 카드.
function edgeScene() {
  const rects = [], card = new Map(), big = new Map(), jobs = new Map();
  for (const el of $("nodes").children) {
    if (el.classList.contains("cluster")) {
      const js = el.querySelectorAll(".jcard");
      if (!js.length) continue;
      const cx = styleNum(el, "left"), cy = styleNum(el, "top");
      const list = [...js].map((j) => ({ ...styleRect(j, cx, cy), owner: j.dataset.owner }));
      jobs.set(el.dataset.ckey, { list, cx, cy });
      rects.push(...list);
      continue;
    }
    if (!el.classList.contains("node")) continue;
    const r = styleRect(el, 0, 0);
    rects.push(r);
    if (el.dataset.ghost) card.set(el.dataset.ghost, r);
    else if (el.dataset.id) (el.classList.contains("big") ? big : card).set(el.dataset.id, r);
  }
  return { rects, card, big, jobs };
}

// 잡을 띄운 카드(없으면 세션의 main 카드)에서 각 잡 카드로 내려가는 줄기.
function jobSpines(c, S) {
  const J = S.jobs.get(clusterKeyOf(c));
  if (!J) return "";
  const mainId = (c.members || []).find((id) => { const n = nodeById(id); return n && n.kind === "main"; }) || (c.members || [])[0];
  const fallback = (mainId && S.card.get(mainId)) || { x: J.cx + 40, y: J.cy + 56, w: 0, h: 0 };
  return J.list.map((j) => {
    const a = (j.owner && S.card.get(j.owner)) || fallback;
    const r = routeEdge(a, j, S.rects, { prefer: "v", spine: true });
    if (!r) return "";
    return `<g class="jobspine"><path d="${r.d}" fill="none" stroke="#35506b" stroke-width="1.3" stroke-dasharray="4 3"/>
      <circle cx="${r.Q.x}" cy="${r.Q.y}" r="2.6" fill="#35506b"/></g>`;
  }).join("");
}

function drawEdges(nodes) {
  const S = edgeScene();
  const tree = nodes.map((n) => {
    const a = n.parent && S.card.get(n.parent), b = a && S.card.get(n.id);
    if (!b) return "";
    const r = routeEdge(a, b, S.rects, { prefer: "h" });
    const d = r ? r.d : curveH(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);   // 겹친 두 카드는 그냥 잇는다
    return `<path d="${d}" fill="none" stroke="#2b4358" stroke-width="1.3"/>`;
  }).join("");
  const spine = CLUSTERS.filter((c) => c.jobs && c.jobs.length).map((c) => jobSpines(c, S)).join("");
  // 미러 카드 → 큰 카드 점선. 큰 카드가 미러 카드를 덮고 있으면 그리지 않는다.
  const big = [...S.big].map(([id, b]) => {
    const a = S.card.get(id), r = a && routeEdge(a, b, S.rects, { prefer: "h" });
    if (!r) return "";
    return `<path d="${r.d}" fill="none" stroke="#4aa8ff" stroke-width="1.8" stroke-dasharray="5 4" opacity="0.9"/>
    <circle cx="${r.P.x}" cy="${r.P.y}" r="3" fill="#4aa8ff"/><circle cx="${r.Q.x}" cy="${r.Q.y}" r="3" fill="#4aa8ff"/>`;
  }).join("");
  $("edges").innerHTML = tree + spine + big;
}

// 끌기·크기 조절 중 한 프레임에 한 번만 다시 그린다.
let edgesFrame = 0;
function scheduleEdges() {
  if (!edgesFrame) edgesFrame = requestAnimationFrame(() => { edgesFrame = 0; drawEdges(NODES); });
}
