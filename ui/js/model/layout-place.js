/* omp-live-map · model · 카드 절대 좌표 배치: 새 카드 빈자리 찾기, 클러스터 테두리 (DOM 접근 없음) */
// A안: 카드마다 지도 절대 좌표(MANUAL["card:"+id])를 갖고, 새 카드만 처음 한 번 자리를 찾는다.
// 클러스터 테두리는 카드·잡을 감싼 결과일 뿐이며 저장 원점(MANUAL[세션키])으로 다시 쓰지 않는다.

const CL = { PAD: 16, HEAD: 62, MINW: 300 };

const cardSize = (id) => SUBSIZE.get(id) || { w: AG.W, h: AG.H };

// start 에서 시작해 rows 행까지 아래로, 다 막히면 오른쪽 열로 넘어가며 겹치지 않는 첫 칸을 고른다.
function freeSlot(start, size, obstacles, rows) {
  for (let col = 0; col < 200; col++) {
    for (let r = 0; r < rows; r++) {
      const b = { x: start.x + col * (AG.W + AG.GAPX), y: start.y + r * (AG.H + AG.GAPY), w: size.w, h: size.h };
      if (!obstacles.some((o) => rectsOverlap(b, o))) return b;
    }
  }
  return { x: start.x, y: start.y, w: size.w, h: size.h };
}

// 저장 좌표가 없는 카드만 놓는다. 부모(보이면 화면 위치, 숨겨졌으면 저장 위치) 오른쪽 40px부터 최대 3행,
// 부모가 없으면 세션 원점 기준 트리 자리에서 아래로 찾는다. 이미 놓인 카드는 장애물일 뿐 밀지 않는다.
function placeFreshCards(fresh, nodes, treePos, base) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = fresh.map((id, i) => [id, i]).sort((a, b) => treePos.get(a[0]).x - treePos.get(b[0]).x || a[1] - b[1]);
  for (const [id] of order) {
    const pid = (byId.get(id) || {}).parent;
    const saved = pid && MANUAL["card:" + pid];
    const parent = pid && (geo.get(pid) || (saved && { x: saved.x, y: saved.y, ...cardSize(pid) }));
    const obstacles = [...geo.values()];
    const p = treePos.get(id);
    geo.set(id, parent
      ? freeSlot({ x: parent.x + parent.w + AG.GAPX, y: parent.y }, cardSize(id), obstacles, AG.ROWMAX)
      : freeSlot({ x: base.x + p.x, y: base.y + p.y }, cardSize(id), obstacles, 200));
  }
}

// 테두리 = 작은 카드·미러·잡의 min/max + 제목 여백. 열린 큰 카드는 넣지 않는다.
function clusterBox(c, rectOf = (id) => geo.get(id)) {
  const rs = [...(c.members || []).map(rectOf).filter(Boolean), ...(c.jobs || [])];
  if (!rs.length) return { x: c.x, y: c.y, w: c.w, h: c.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0 - CL.PAD, y: y0 - CL.PAD - CL.HEAD, w: Math.max(CL.MINW, x1 - x0 + CL.PAD * 2), h: y1 - y0 + CL.PAD * 2 + CL.HEAD };
}

// 전환 전(LAYOUT_V2 아님)에는 기존 규칙대로 원점 틀을 유지하고 크기를 키운 카드만 오른쪽·아래로 감싼다.
function fitCluster(c) {
  if (LAYOUT_V2) { Object.assign(c, clusterBox(c)); return; }
  for (const id of c.members || []) {
    const g = geo.get(id);
    if (!g || !SUBSIZE.has(id)) continue;
    c.w = Math.max(c.w, g.x + g.w + CL.PAD - c.x);
    c.h = Math.max(c.h, g.y + g.h + CL.PAD - c.y);
  }
}
