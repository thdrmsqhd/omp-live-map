/* omp-live-map · model · 카드 배치 기하 계산 (DOM 접근 없음) */

const agentKind = (k) => k === "main" || k === "sub";

const blockKeyOf = (b) => b.key || (b.s && "3:session:" + b.s.key) || b.kind;

function keyHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

// 블록 수가 ±1 흔들릴 때 열 구성을 바꾸지 않는다(위치 점프 방지).
function chooseCols(n) {
  const target = Math.max(1, Math.min(12, Math.round(Math.sqrt(n * 1.4)) || 1));
  if (!LAYOUT.cols) { LAYOUT.cols = target; LAYOUT.n = n; return target; }
  if (target === LAYOUT.cols) { LAYOUT.n = n; return LAYOUT.cols; }
  if (Math.abs(n - LAYOUT.n) >= 2) { LAYOUT.cols = target; LAYOUT.n = n; }
  return LAYOUT.cols;
}

function layoutTree(nodes, P) {
  const { W, H, GAPX, GAPY, ROWMAX } = P;
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map();
  for (const n of nodes) {
    const p = n.parent && ids.has(n.parent) ? n.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  for (const arr of kids.values()) arr.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  const pos = new Map();
  let cursor = 0;
  const assign = (n, depth) => {
    const cs = kids.get(n.id) || [];
    if (!cs.length) {
      const y = cursor;
      cursor += H + GAPY;
      pos.set(n.id, { x: depth * (W + GAPX), y });
      return y;
    }
    // 잎 자식은 부모 바로 오른쪽부터 여러 열로 묶는다.
    if (cs.every((c) => !(kids.get(c.id) || []).length)) {
      const top = cursor;
      const rows = Math.min(cs.length, ROWMAX);
      const gridH = rows * H + Math.max(0, rows - 1) * GAPY;
      cs.forEach((c, i) => pos.set(c.id, {
        x: (depth + 1 + Math.floor(i / ROWMAX)) * (W + GAPX),
        y: top + (i % ROWMAX) * (H + GAPY),
      }));
      cursor = top + gridH + GAPY;
      const y = top + (gridH - H) / 2;
      pos.set(n.id, { x: depth * (W + GAPX), y });
      return y;
    }
    const ys = cs.map((c) => assign(c, depth + 1));
    pos.set(n.id, { x: depth * (W + GAPX), y: (ys[0] + ys[ys.length - 1]) / 2 });
    return pos.get(n.id).y;
  };
  for (const root of kids.get(null) || []) { assign(root, 0); cursor += GAPY * 2; }
  let maxX = 0, maxY = 0;
  for (const p of pos.values()) { maxX = Math.max(maxX, p.x + W); maxY = Math.max(maxY, p.y + H); }
  return { pos, w: maxX, h: maxY };
}

const jobLive = (j) => !j.done && Date.now() - (j.ts || 0) < 30 * 60e3;

// 끝난 잡은 바로 감춘다. 스테이지 잡 카드와 카드 안 bg 블록이 같은 규칙을 쓴다.
// 앱 잡(BGS/BGALL)은 서버가 실제 프로세스 상태를 주므로 done 만 본다.
const jobVisible = (j) => !j.done;

const activeJobs = (s) => (s.jobs || []).filter(jobLive).slice(0, JOB.MAX);

function layoutInfraInto(nodes, map, ox, oy) {
  const W = IF.W, H = IF.H, GAPX = IF.GAPX, COLS = IF.COLS;
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map();
  for (const n of nodes) {
    const p = n.parent && ids.has(n.parent) ? n.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  let y = 0, maxX = 0;
  for (const root of kids.get(null) || []) {
    map.set(root.id, { x: ox, y: oy + y, w: W, h: H });
    let py = y;
    for (const proj of kids.get(root.id) || []) {
      map.set(proj.id, { x: ox + W + GAPX, y: oy + py, w: W, h: H });
      const ct = kids.get(proj.id) || [];
      const gx = ox + W + GAPX + W + GAPX;
      ct.forEach((c, i) => map.set(c.id, { x: gx + (i % COLS) * (W + 12), y: oy + py + Math.floor(i / COLS) * (H + 10), w: W, h: H }));
      const rows = Math.max(1, Math.ceil(ct.length / COLS));
      py += Math.max(H, rows * (H + 10)) + 28;
      maxX = Math.max(maxX, gx + COLS * (W + 12) - ox);
    }
    y = Math.max(y + H, py) + 34;
    maxX = Math.max(maxX, W + GAPX + W);
  }
  return { w: Math.max(maxX + 8, W * 3), h: y };
}

function infraFolder() {
  if (INFRA.error) return INFRA.error;
  return (INFRA.projects || []).map((p) => p.name + " " + p.up + "/" + p.total).join(" · ").slice(0, 80);
}

function infraLive() {
  return (INFRA.containers || []).some((c) => c.state === "running");
}

function shiftCluster(c, dx, dy) {
  c.x += dx; c.y += dy;
  if (c.ox != null) { c.ox += dx; c.oy += dy; }
  for (const id of c.members || []) {
    const g = geo.get(id);
    if (g) { g.x += dx; g.y += dy; }
  }
  for (const j of c.jobs || []) { j.x += dx; j.y += dy; }
}

// 겹친 클러스터를 밀어낸다. 큰 카드는 위에 뜨는 창이라 대상이 아니다.
// 자리를 확정한 클러스터(fixed: 저장 원점이 있는 세션·로컬 카드)는 밀지 않고, 새 클러스터만 비켜 놓는다.
function separateCards() {
  // 밀어내기 순서가 렌더마다 달라지지 않도록 키로 정렬한다.
  const bk = (c) => (c.key || c.kind) + ":" + (c.title || "");
  const boxes = [...CLUSTERS].sort((a, b) => (bk(a) < bk(b) ? -1 : bk(a) > bk(b) ? 1 : 0));
  const M = 42;
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.fixed && b.fixed) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox <= -M || oy <= -M) continue;      // already clear
        if (ox <= 0 || oy <= 0) continue;         // no intersection at all
        moved = true;
        const [s, m] = b.fixed ? [b, a] : [a, b];  // s 는 그대로, m 을 s 오른쪽 또는 아래로
        const dx = s.x + s.w + M - m.x;
        const dy = s.y + s.h + M - m.y;
        if (Math.abs(dx) <= Math.abs(dy)) shiftBox(m, dx, 0);
        else shiftBox(m, 0, dy);
      }
    }
    if (!moved) break;
  }
}

function shiftBox(c, dx, dy) {
  shiftCluster(c, dx, dy);
  const L = c.kind === "local" ? LOCALS.find((l) => l.id === c.key) : null;
  if (L) { L.x += dx; L.y += dy; saveLocalsThrottled(); }
}

const nodeById = (id) => NODES.find((n) => n.id === id);

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
