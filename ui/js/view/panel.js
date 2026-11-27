/* omp-live-map · view · 큰 카드 열기·닫기·자동 배치와 공용 표시 도우미 */

// 큰 카드 열기. 이미 열려 있으면 닫지 않고 그 카드로 화면을 옮긴다(닫기는 toggleCard·카드 − 버튼·목록 ✕).
function openNode(id) {
  if (typeof mapMode !== "undefined" && mapMode === "overview") setMapMode("workspace", false);
  const was = openIds.has(id);
  if (!was) {
    openIds.add(id);
    if (typeof dockOnOpen === "function") dockOnOpen(id);   // 메인을 다시 열면 그 세션 서브를 다시 붙인다
    saveOpenCards();
  }
  activateCard(id);
  renderMap(false, true);
  if (!openIds.has(id)) return;
  if (mapMode === "map") {
    if (was) { focusCluster(id); flashCard(id); }
    else revealCard(id);
  }
  loadBg(id);
}

function toggleCard(id) {
  if (!openIds.has(id)) return openNode(id);
  closeCard(id);
  renderMap(false, true);
}

// 큰 카드(와 붙은 서브·클러스터)가 한 화면에 들어오게 맞춘다.
function focusCluster(nodeId) {
  const c = clusterOfCard(nodeId) || geo.get(nodeId);
  const extra = typeof dockFocusBoxes === "function" ? dockFocusBoxes(nodeId) : [];
  const b = boundsOf([c, SATS.get(nodeId), ...extra].filter(Boolean));
  if (b) fitBox(b, 24, 180);
}

// 새로 연 카드는 이미 화면 안 빈 자리에 놓였다. 화면 밖(로컬·인프라 옆 등)이면 그때만 옮긴다.
function revealCard(id) {
  const c = clusterOfCard(id);
  const extra = typeof dockFocusBoxes === "function" ? dockFocusBoxes(id) : [];
  const b = boundsOf([c, SATS.get(id), ...extra].filter(Boolean));
  if (!b) return;
  const st = $("stage").getBoundingClientRect();
  const x = b.x * view.k + view.x, y = b.y * view.k + view.y;
  const inside = x >= 0 && y >= 0 && x + b.w * view.k <= st.width && y + b.h * view.k <= st.height;
  // 새 카드는 읽을 수 있는 배율(최대 100%)로 맞춘다. 카드 기본 크기가 무대에 맞춰져 있어 보통 100%가 된다.
  if (!inside) fitBox(b, 24, 180, 0.22, 1);
}

function flashCard(id) {
  const el = $("nodes").querySelector(`.node.big[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;   // 같은 카드를 연달아 눌러도 애니메이션이 다시 돈다
  el.classList.add("flash");
}

// 카드 하나를 화면 가운데로 가져와 잠깐 강조한다(세션 컨텍스트 목록·알림에서 이동). 닫혀 있으면 연다.
function focusCard(id) {
  activateCard(id);
  if (!openIds.has(id)) { if (nodeInData(id)) openNode(id); return; }
  if (mapMode === "overview") { setMapMode("workspace"); return; }
  if (mapMode === "workspace") { renderMap(false, true); return; }
  const g = SATS.get(id);
  if (!g) return;
  const st = $("stage").getBoundingClientRect();
  const k = Math.max(view.k, 0.7);
  animateView({ k, x: st.width / 2 - (g.x + g.w / 2) * k, y: st.height / 2 - (g.y + g.h / 2) * k }, 200);
  flashCard(id);
}

// 새 큰 카드의 기본 크기: 100% 배율에서 지금 무대(세션 목록 제외)에 다 들어오는 크기.
// 너무 작은 창에서도 블록이 비좁지 않게 960×640 아래로는 줄이지 않는다.
const BIG_MIN_W = 960, BIG_MIN_H = 640;
function bigCardSize() {
  if (readJSON("omp-map-legacy-card-size", false) === true) return { w: BIG_W, h: BIG_H };
  const st = $("stage").getBoundingClientRect();
  const clamp = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, v)));
  return { w: clamp(st.width - 48, BIG_MIN_W, 1600), h: clamp(st.height - 48, BIG_MIN_H, 1000) };
}

// 큰 카드를 처음 열 때의 자리(로컬·인프라): 클러스터 오른쪽. 다른 카드와 겹치면 아래가 아니라 그 카드 오른쪽으로 민다.
function placeSatellite(anchor) {
  const obstacles = [...CLUSTERS, ...geo.values(), ...SATS.values(), ...JOBS];
  const box = { x: anchor.x + anchor.w + 80, y: anchor.y, ...bigCardSize() };
  for (let i = 0; i < 400; i++) {
    const hit = obstacles.find((r) => rectsOverlap(box, r));
    if (!hit) break;
    box.x = hit.x + hit.w + 40;
  }
  return box;
}

// 큰 카드를 처음 열 때의 자리(세션 에이전트): 지금 화면 안에서 다른 카드와 겹치지 않는 첫 자리.
// 1) 카드 전체가 화면에 들어오는 자리 2) 왼쪽 위가 화면 안인 자리 3) 화면 왼쪽 위에서 겹치는 카드 오른쪽으로 민 자리.
function placeInView(w, h) {
  const st = $("stage").getBoundingClientRect();
  const v = { x: -view.x / view.k, y: -view.y / view.k, w: st.width / view.k, h: st.height / view.k };
  const obstacles = [...CLUSTERS, ...geo.values(), ...SATS.values(), ...JOBS];
  const M = 20, step = Math.max(40, Math.round(v.w / 36));
  const scan = (x1, x2, y1, y2) => {
    for (let y = y1; y <= y2; y += step) {
      for (let x = x1; x <= x2; x += step) {
        const box = { x: Math.round(x), y: Math.round(y), w, h };
        if (!obstacles.some((r) => rectsOverlap(box, r))) return box;
      }
    }
    return null;
  };
  const full = scan(v.x + M, v.x + v.w - w - M, v.y + M, v.y + v.h - h - M);
  if (full) return full;
  const corner = scan(v.x + M, v.x + v.w - Math.min(w, v.w / 2), v.y + M, v.y + v.h - Math.min(h, v.h / 2));
  if (corner) return corner;
  const box = { x: Math.round(v.x + M), y: Math.round(v.y + M), w, h };
  for (let i = 0; i < 400; i++) {
    const hit = obstacles.find((r) => rectsOverlap(box, r));
    if (!hit) break;
    box.x = hit.x + hit.w + 40;
  }
  return box;
}

// 엘리먼트 글자를 잠시 바꿨다가 되돌린다(복사됨 표시 등).
function flashText(el, text, ms = 1200) {
  if (!el) return;
  if (!el.dataset.flash) el.dataset.orig = el.textContent;
  el.dataset.flash = "1";
  el.textContent = text;
  clearTimeout(el.__flashT);
  el.__flashT = setTimeout(() => {
    el.textContent = el.dataset.orig || "";
    delete el.dataset.flash;
    delete el.dataset.orig;
  }, ms);
}

function copyText(text, el) {
  if (!navigator.clipboard) { flashText(el, "복사 실패"); return; }
  navigator.clipboard.writeText(String(text ?? "")).then(() => flashText(el, "복사됨"), () => flashText(el, "복사 실패"));
}
