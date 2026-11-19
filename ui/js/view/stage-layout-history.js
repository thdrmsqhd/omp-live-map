/* omp-live-map · view · 배치 되돌리기(Ctrl+Z)와 끌기 스냅·가이드 */
// 이동·크기 조절 1회 = 이력 1개. 그때 바뀐 키의 이전 값만 담아 그 키만 되돌린다.
// 자동 배치로 새로 저장된 카드 좌표는 이력에 없으므로 되돌려도 지워지지 않는다.

// keys: { manual: [MANUAL 키], big: [BIGPOS id], locals: [로컬 카드 id] }
function layoutSnapshot(keys) {
  const copy = (v) => (v ? { ...v } : null);
  return {
    manual: (keys.manual || []).map((k) => [k, copy(MANUAL[k])]),
    big: (keys.big || []).map((id) => [id, copy(BIGPOS.get(id))]),
    locals: (keys.locals || []).map((id) => LOCALS.find((l) => l.id === id)).filter(Boolean).map((L) => [L.id, L.x, L.y]),
  };
}

function pushHistory(snap) {
  HISTORY.push(snap);
  if (HISTORY.length > HIST_MAX) HISTORY.shift();
}

function undoLayout() {
  const prev = HISTORY.pop();
  if (!prev) return false;
  for (const [k, v] of prev.manual) if (v) MANUAL[k] = v; else delete MANUAL[k];
  for (const [id, v] of prev.big) if (v) BIGPOS.set(id, v); else BIGPOS.delete(id);
  for (const [id, x, y] of prev.locals) {
    const L = LOCALS.find((l) => l.id === id);
    if (L) { L.x = x; L.y = y; }
  }
  saveManual();
  saveLocals();
  saveOpenCards();
  renderMap(false, true);
  return true;
}

// 8px(화면 기준) 안에 들어오면 다른 클러스터의 변에 붙는다. r 은 움직이는 사각형(카드 또는 클러스터).
function snapDelta(r, dx, dy, skip) {
  const TH = 8 / Math.max(0.2, view.k);
  let bx = null, by = null;
  const guides = [];
  const mx = [r.x + dx, r.x + dx + r.w], my = [r.y + dy, r.y + dy + r.h];
  for (const o of CLUSTERS) {
    if (skip(o)) continue;
    for (const a of mx) for (const b of [o.x, o.x + o.w]) {
      const d = b - a;
      if (Math.abs(d) <= TH && (bx === null || Math.abs(d) < Math.abs(bx))) bx = d;
    }
    for (const a of my) for (const b of [o.y, o.y + o.h]) {
      const d = b - a;
      if (Math.abs(d) <= TH && (by === null || Math.abs(d) < Math.abs(by))) by = d;
    }
  }
  if (bx !== null) { dx += bx; guides.push(["v", mx[0] + bx]); }
  if (by !== null) { dy += by; guides.push(["h", my[0] + by]); }
  return { dx, dy, guides };
}

function drawGuides(list) {
  const g = $("guides");
  if (!list.length) { g.innerHTML = ""; return; }
  const b = boundsOf(CLUSTERS) || { x: 0, y: 0, w: 0, h: 0 };
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4aa8ff" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>`;
  g.innerHTML = list.map(([axis, v]) => (axis === "v"
    ? line(v, b.y - 40, v, b.y + b.h + 40)
    : line(b.x - 40, v, b.x + b.w + 40, v))).join("");
}
