/* omp-live-map · model · 관제 벽: 프로젝트마다 타일 하나를 화면 폭에 맞춘 격자(2~4열)에 채워 놓는다. DOM·상태 접근 없음.
   격자 단위: 열(col) × 줄 칸(row). 타일 크기 { w(열), h(줄 칸) }. 기본 크기는 내용으로 정한다 — 일이 있는 타일(개입 필요·진행 중)은
   ACTIVE_H 칸(내용이 그보다 적으면 내용 높이 need 칸까지만 — 반쯤 빈 타일을 만들지 않는다), 쉬는 타일(도는 것·기다리는 것 없음)은
   머리 + 최근 끝난 일 2~3개(제목 · 결과 한 줄 · 언제)가 다 보이는 칸 수(idleH, umapIdleRows). 접기·펼치기 단추는 없다.
   순서: 사용자가 끌어 바꾼 순서(order)가 있으면 그 순서, 없으면 개입 필요 → 진행 중 → 쉬는 중(같은 묶음은 최근 활동 순).
   크기를 바꾼 타일(sizes[key])은 상태와 상관없이 그 크기다. */

const UMAP_WALL = Object.freeze({
  PAD: 12, GAP: 12, TILE_MIN_W: 440, COLS_MIN: 2, COLS_MAX: 4,
  ROWS_VIEW: 8, UNIT_MIN: 80, UNIT_MAX: 120, ACTIVE_H: 4, IDLE_H: 1, IDLE_MAX: 3, MAX_H: 16, NEED_MIN: 2,
  // 타일 머리(이름 · 지표 · 상태 한 줄)와 테두리 높이(px, CSS .um-tile-head 와 같아야 한다). 내용 높이 → 칸 수 계산에 쓴다.
  HEAD_PX: 86,
  // 쉬는 타일: 머리 두 줄(이름 · 지표) + 최근 끝난 일 한 개당 두 줄(css/umap.css .um-recent li 높이 + 틈). 없으면 '최근 기록 없음' 한 줄.
  IDLE_HEAD_PX: 66, RECENT_PX: 40, RECENT_EMPTY_PX: 22,
});
const UMAP_TILE_RANK = Object.freeze({ attention: 0, running: 1, idle: 2 });
const UMAP_TILE_LABEL = Object.freeze({ attention: "개입 필요", running: "진행 중", idle: "쉬는 중" });

// 화면(view {width,height}, px) → 격자: 열 수(타일이 TILE_MIN_W 이상이 되게 2~4열), 열 폭, 줄 칸 높이(한 화면에 ROWS_VIEW 칸).
function umapWallGrid(view) {
  const W = UMAP_WALL, width = Math.max(0, view?.width || 0), height = Math.max(0, view?.height || 0);
  const cols = Math.max(W.COLS_MIN, Math.min(W.COLS_MAX, Math.floor((width - 2 * W.PAD + W.GAP) / (W.TILE_MIN_W + W.GAP))));
  const unitW = Math.max(160, Math.floor((width - 2 * W.PAD - (cols - 1) * W.GAP) / cols));
  const unitH = Math.max(W.UNIT_MIN, Math.min(W.UNIT_MAX, Math.floor((height - 2 * W.PAD - (W.ROWS_VIEW - 1) * W.GAP) / W.ROWS_VIEW)));
  // rows: 한 화면에 들어가는 줄 칸 수(일하는 타일을 이만큼 키워 화면을 채운다).
  const rows = Math.max(1, Math.floor((height - 2 * W.PAD + W.GAP) / (unitH + W.GAP)));
  return { cols, unitW, unitH, gap: W.GAP, pad: W.PAD, rows };
}

// tiles: [{ key, state: 'attention'|'running'|'idle', at(최근 활동 ms), busy?, need?(내용이 다 보이는 칸 수) }] → 그릴 순서(key 목록).
function umapWallOrder(tiles, order) {
  const rank = new Map((order || []).map((key, index) => [key, index]));
  const auto = [...tiles].sort((a, b) => (UMAP_TILE_RANK[a.state] ?? 2) - (UMAP_TILE_RANK[b.state] ?? 2)
    || (b.at || 0) - (a.at || 0) || String(a.key).localeCompare(String(b.key)));
  if (!auto.some((tile) => rank.has(tile.key))) return auto.map(({ key }) => key);
  // 저장한 순서의 타일이 먼저(그 순서대로), 새로 생긴 타일은 뒤에 상태 순서로.
  return [...auto.filter((tile) => rank.has(tile.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key)), ...auto.filter((tile) => !rank.has(tile.key))].map(({ key }) => key);
}

// 타일 크기(격자 단위). 저장한 크기가 있으면 그 크기(열 수에 맞춰 자른다), 없으면 내용으로: 쉬는 타일은 작게, 일하는 타일은 activeH 칸.
function umapTileSize(tile, sizes, cols, activeH = UMAP_WALL.ACTIVE_H) {
  const W = UMAP_WALL, saved = sizes?.[tile.key];
  if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
    return { w: Math.max(1, Math.min(cols, Math.round(saved.w))), h: Math.max(1, Math.min(W.MAX_H, Math.round(saved.h))), auto: false };
  }
  // busy: 쉬는 타일이라도 지금 그 안에서 입력 중(＋ Task 한 줄)이면 일하는 크기. need: 내용이 activeH 보다 적으면 그 칸 수까지만(최소 NEED_MIN).
  // small: 쉬는 타일은 머리(최근 끝난 일 목록 포함)만 그린다 — 본문 캔버스가 없다.
  if (tile.state === "idle" && !tile.busy) {
    const h = Number.isFinite(tile.idleH) && tile.idleH > 0 ? Math.round(tile.idleH) : W.IDLE_H;
    return { w: 1, h: Math.max(W.IDLE_H, Math.min(W.IDLE_MAX, h)), auto: true, small: true };
  }
  const need = Number.isFinite(tile.need) && tile.need > 0 ? Math.max(W.NEED_MIN, Math.ceil(tile.need)) : activeH;
  return { w: 1, h: Math.min(activeH, need), auto: true };
}
// 쉬는 타일 높이(px): 머리 + 최근 끝난 일 n개. 타일은 이 높이로 그리고(칸이 남아도 빈 줄을 그리지 않는다), 칸 수는 umapIdleRows.
const umapIdlePx = (n) => UMAP_WALL.IDLE_HEAD_PX + (n > 0 ? n * UMAP_WALL.RECENT_PX : UMAP_WALL.RECENT_EMPTY_PX);
// 쉬는 타일에 최근 끝난 일 n개를 다 보이게 하는 줄 칸 수.
function umapIdleRows(n, grid) {
  const W = UMAP_WALL, px = umapIdlePx(n);
  return Math.max(W.IDLE_H, Math.min(W.IDLE_MAX, Math.ceil((px + grid.gap) / (grid.unitH + grid.gap))));
}
// 타일 안에 그릴 높이(px, 머리 제외) → 다 보이는 줄 칸 수.
function umapWallRows(bodyPx, grid) {
  const px = UMAP_WALL.HEAD_PX + Math.max(0, bodyPx || 0);
  return Math.max(1, Math.ceil((px + grid.gap) / (grid.unitH + grid.gap)));
}

// 격자 채우기: 순서대로, 들어갈 수 있는 가장 위·왼쪽 칸에 놓는다(겹치지 않는다).
// fitRows(한 화면 줄 칸 수)를 주면 크기를 저장하지 않은 일하는 타일을 ACTIVE_H 보다 키워, 벽이 한 화면을 넘지 않는 가장 큰 높이로 화면을 채운다
// (넓은 화면에 프로젝트가 적으면 타일이 길어져 카드가 더 보인다. 한 화면에 안 들어가면 ACTIVE_H 그대로).
// 돌려주는 값: { tiles: [{ key, state, col, row, w, h, auto }], rows(쓴 줄 칸 수), order(그린 순서), activeH }
function umapWallPack(tiles, { cols = 3, order = [], sizes = {}, fitRows = 0 } = {}) {
  for (let activeH = Math.min(UMAP_WALL.MAX_H, fitRows); activeH > UMAP_WALL.ACTIVE_H; activeH--) {
    const pack = umapWallPlace(tiles, cols, order, sizes, activeH);
    if (pack.rows <= fitRows) return pack;
  }
  return umapWallPlace(tiles, cols, order, sizes, UMAP_WALL.ACTIVE_H);
}
function umapWallPlace(tiles, cols, order, sizes, activeH) {
  const byKey = new Map(tiles.map((tile) => [tile.key, tile]));
  const keys = umapWallOrder(tiles, order);
  const used = [];
  const free = (row, col, w, h) => {
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (used[r]?.[c]) return false;
    return true;
  };
  const out = [];
  let rows = 0;
  for (const key of keys) {
    const tile = byKey.get(key), size = umapTileSize(tile, sizes, cols, activeH);
    let row = 0, col = 0;
    for (;; row++) {
      col = -1;
      for (let c = 0; c + size.w <= cols; c++) if (free(row, c, size.w, size.h)) { col = c; break; }
      if (col >= 0) break;
    }
    for (let r = row; r < row + size.h; r++) { used[r] = used[r] || []; for (let c = col; c < col + size.w; c++) used[r][c] = key; }
    out.push({ key, state: tile.state, col, row, ...size });
    rows = Math.max(rows, row + size.h);
  }
  return { tiles: out, rows, order: keys, activeH };
}

// 격자 단위 → 화면 px(벽 좌표). 벽 전체 크기도 준다.
function umapWallRect(tile, grid) {
  return { x: grid.pad + tile.col * (grid.unitW + grid.gap), y: grid.pad + tile.row * (grid.unitH + grid.gap),
    w: tile.w * grid.unitW + (tile.w - 1) * grid.gap, h: tile.h * grid.unitH + (tile.h - 1) * grid.gap };
}
const umapWallSize = (pack, grid) => ({ width: grid.pad * 2 + grid.cols * grid.unitW + (grid.cols - 1) * grid.gap,
  height: grid.pad * 2 + Math.max(0, pack.rows * grid.unitH + (pack.rows - 1) * grid.gap) });

// 모서리 끌기로 바꾼 px 크기 → 가장 가까운 격자 크기.
function umapWallSnap(width, height, grid) {
  return { w: Math.max(1, Math.min(grid.cols, Math.round((width + grid.gap) / (grid.unitW + grid.gap)))),
    h: Math.max(1, Math.min(UMAP_WALL.MAX_H, Math.round((height + grid.gap) / (grid.unitH + grid.gap)))) };
}

// 타일을 벽 좌표 (x, y) 에 놓았을 때의 새 순서: 그 칸을 덮은 타일 자리로, 빈 칸이면 그 칸보다 뒤(줄·열 순)에 있는 첫 타일 자리로.
function umapWallDrop(pack, key, x, y, grid) {
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor((x - grid.pad) / (grid.unitW + grid.gap))));
  const row = Math.max(0, Math.floor((y - grid.pad) / (grid.unitH + grid.gap)));
  const keys = pack.order.filter((item) => item !== key);
  const others = pack.tiles.filter((tile) => tile.key !== key);
  const cover = others.find((tile) => col >= tile.col && col < tile.col + tile.w && row >= tile.row && row < tile.row + tile.h);
  const next = cover ? null : others.find((tile) => tile.row > row || (tile.row === row && tile.col > col));
  // 덮은 타일이 끄는 타일보다 뒤에 있었으면 그 뒤로(한 칸 뒤 타일에 놓아도 자리가 바뀐다), 앞이었으면 그 앞으로.
  const after = cover && pack.order.indexOf(cover.key) > pack.order.indexOf(key);
  const index = cover ? keys.indexOf(cover.key) + (after ? 1 : 0) : next ? keys.indexOf(next.key) : keys.length;
  keys.splice(index, 0, key);
  return keys;
}
