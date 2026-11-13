/* omp-live-map · model · 관계선 경로 — 양 끝 카드의 가까운 변에서 나가 다른 카드 사각형을 돌아가는 길 (순수 기하) */
// 직선 곡선이 카드를 가로지르지 않으면 그대로 쓰고, 가로지르면 카드 사이 통로를 따라가는 직각 경로 후보 중
// 가로지르는 카드 수가 가장 적고(0개 우선) 짧은 것을 고른다. 완전 회피가 불가능하면 가장 적게 걸치는 경로.

const ROUTE_GAP = 6;     // 변에서 나오는 꼬리 길이. 카드 사이 통로(10~12px)의 중앙에 오도록 6px.
const ROUTE_NEAR = 320;  // 우회 통로 후보를 찾을 범위(양 끝을 감싼 사각형에서 이만큼 바깥까지)
const ROUTE_BEND = 30;   // 꺾임 1번의 비용(px 길이로 환산)

const SIDE = {
  L: (r) => ({ x: r.x, y: r.y + r.h / 2, dx: -1, dy: 0 }),
  R: (r) => ({ x: r.x + r.w, y: r.y + r.h / 2, dx: 1, dy: 0 }),
  T: (r) => ({ x: r.x + r.w / 2, y: r.y, dx: 0, dy: -1 }),
  B: (r) => ({ x: r.x + r.w / 2, y: r.y + r.h, dx: 0, dy: 1 }),
};
const SIDE_ALL = ["R", "L", "B", "T"];

// 선분이 사각형 안쪽(테두리 1px 제외)을 지나는지 — Liang–Barsky 절단.
function segHitsRect(x1, y1, x2, y2, r) {
  const L = r.x + 1, R = r.x + r.w - 1, T = r.y + 1, B = r.y + r.h - 1;
  if (Math.max(x1, x2) <= L || Math.min(x1, x2) >= R || Math.max(y1, y2) <= T || Math.min(y1, y2) >= B) return false;
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x1 - L) && clip(dx, R - x1) && clip(-dy, y1 - T) && clip(dy, B - y1) && t0 < t1;
}

// 꺾은선이 지나는 카드 수. limit 에 닿으면 더 세지 않는다(그보다 나은 후보가 아니므로).
function pathHits(pts, rects, limit) {
  let n = 0;
  for (const r of rects) {
    for (let i = 1; i < pts.length; i++) {
      if (segHitsRect(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r)) { if (++n >= limit) return n; break; }
    }
  }
  return n;
}

const bez = (p, c1, c2, q, t) => {
  const u = 1 - t;
  return [u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q[0],
    u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q[1]];
};

// 가로/세로로 마주 보는 변 사이의 S 곡선(기존 모양). 판정용 표본점과 SVG d 를 함께 낸다.
function facingCurve(P, Q, horiz) {
  const p = [P.x, P.y], q = [Q.x, Q.y];
  const m = horiz ? (P.x + Q.x) / 2 : (P.y + Q.y) / 2;
  const c1 = horiz ? [m, P.y] : [P.x, m], c2 = horiz ? [m, Q.y] : [Q.x, m];
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(bez(p, c1, c2, q, i / 12));
  return { pts, d: `M${p} C${c1} ${c2} ${q}` };
}

// 같은 점·일직선 중간점을 지운다.
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const a = out[out.length - 1], b = out[out.length - 2];
    if (a && a[0] === p[0] && a[1] === p[1]) continue;
    if (a && b && ((b[0] === a[0] && a[0] === p[0]) || (b[1] === a[1] && a[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;

// 모서리를 둥글린 꺾은선.
function roundedPath(pts, rad = 8) {
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x, y] = pts[i], [x2, y2] = pts[i + 1];
    const k1 = Math.min(rad, Math.hypot(x - x0, y - y0) / 2), k2 = Math.min(rad, Math.hypot(x2 - x, y2 - y) / 2);
    const ax = x - Math.sign(x - x0) * k1, ay = y - Math.sign(y - y0) * k1;
    const bx = x + Math.sign(x2 - x) * k2, by = y + Math.sign(y2 - y) * k2;
    d += ` L${r1(ax)},${r1(ay)} Q${r1(x)},${r1(y)} ${r1(bx)},${r1(by)}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${r1(z[0])},${r1(z[1])}`;
}

const pathCost = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  return s + (pts.length - 2) * ROUTE_BEND;
};

// 한 쌍의 변(sa→sb)에 대한 직각 경로 후보: L자 2개, 세로 통로 X, 가로 통로 Y.
function orthoCandidates(a, b, sa, sb, xs, ys, out) {
  const P = SIDE[sa](a), Q = SIDE[sb](b);
  const p = [P.x, P.y], q = [Q.x, Q.y];
  const p1 = [P.x + P.dx * ROUTE_GAP, P.y + P.dy * ROUTE_GAP], q1 = [Q.x + Q.dx * ROUTE_GAP, Q.y + Q.dy * ROUTE_GAP];
  const add = (mid) => { const pts = simplify([p, p1, ...mid, q1, q]); out.push({ pts, cost: pathCost(pts), P, Q }); };
  add([[q1[0], p1[1]]]);
  add([[p1[0], q1[1]]]);
  for (const x of xs) add([[x, p1[1]], [x, q1[1]]]);
  for (const y of ys) add([[p1[0], y], [q1[0], y]]);
}

// 비용 순으로 훑어 가로지름이 best 보다 적은 첫 후보를 고른다(0개면 즉시 끝).
function pickBest(cands, rects, best) {
  cands.sort((m, n) => m.cost - n.cost);
  for (const c of cands) {
    const h = pathHits(c.pts, rects, best.hits);
    if (h < best.hits) { best = { hits: h, pts: c.pts, P: c.P, Q: c.Q, d: null }; if (!h) break; }
  }
  return best;
}

// a, b: 양 끝 카드 사각형 {x,y,w,h}. rects: 피해야 할 카드 사각형 전부(양 끝 포함 — 자기 카드를 되돌아 뚫는 길도 막는다).
// opt.prefer "h"|"v": 기본 연결 방향. opt.spine: 세로 연결의 기본 모양을 곡선 대신 꺾은선(잡 줄기)으로.
// 반환 { d, P, Q, hits } — 두 카드가 겹쳐 마주 보는 변이 없으면 null.
function routeEdge(a, b, rects, opt = {}) {
  const sepH = b.x >= a.x + a.w || b.x + b.w <= a.x;
  const sepV = b.y >= a.y + a.h || b.y + b.h <= a.y;
  if (!sepH && !sepV) return null;
  const hp = b.x + b.w / 2 >= a.x + a.w / 2 ? ["R", "L"] : ["L", "R"];
  const vp = b.y + b.h / 2 >= a.y + a.h / 2 ? ["B", "T"] : ["T", "B"];
  const horiz = sepH && (opt.prefer !== "v" || !sepV);
  const [sa, sb] = horiz ? hp : vp;
  const P = SIDE[sa](a), Q = SIDE[sb](b);
  let first;
  if (!horiz && opt.spine) {
    const my = Q.y + Q.dy * 14;   // 들어가는 변 바로 앞 14px 에서 꺾는다(기존 잡 줄기 모양)
    const pts = simplify([[P.x, P.y], [P.x, my], [Q.x, my], [Q.x, Q.y]]);
    first = { pts, d: roundedPath(pts, 4) };
  } else first = facingCurve(P, Q, horiz);
  let best = { hits: pathHits(first.pts, rects, Infinity), d: first.d, P, Q };
  if (!best.hits) return best;

  const bx0 = Math.min(a.x, b.x) - ROUTE_NEAR, bx1 = Math.max(a.x + a.w, b.x + b.w) + ROUTE_NEAR;
  const by0 = Math.min(a.y, b.y) - ROUTE_NEAR, by1 = Math.max(a.y + a.h, b.y + b.h) + ROUTE_NEAR;
  const xs = new Set(), ys = new Set();
  for (const r of rects) {
    if (r.x > bx1 || r.x + r.w < bx0 || r.y > by1 || r.y + r.h < by0) continue;
    xs.add(r.x - ROUTE_GAP); xs.add(r.x + r.w + ROUTE_GAP);
    ys.add(r.y - ROUTE_GAP); ys.add(r.y + r.h + ROUTE_GAP);
  }
  const pairs = [hp, vp];
  let cands = [];
  for (const [s1, s2] of pairs) orthoCandidates(a, b, s1, s2, xs, ys, cands);
  best = pickBest(cands, rects, best);
  if (best.hits) {
    // 마주 보는 변으로 안 되면 나머지 변 조합까지 넓힌다.
    cands = [];
    for (const s1 of SIDE_ALL) for (const s2 of SIDE_ALL) {
      if (pairs.some(([x, y]) => x === s1 && y === s2)) continue;
      orthoCandidates(a, b, s1, s2, xs, ys, cands);
    }
    best = pickBest(cands, rects, best);
  }
  if (!best.d) best.d = roundedPath(best.pts);
  return best;
}
