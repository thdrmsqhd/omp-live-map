/* omp-live-map · view · 메인 큰 카드에 실행 중 서브에이전트 카드 도킹 */
// 메인 카드를 열면 그 세션에서 실행 중인 서브에이전트 카드가 오른쪽에 세로로 붙는다. 자동으로 붙인 서브(SUBDOCK)가 완료되면 그 카드는 자동으로 닫힌다. 손으로 연 완료 서브 카드는 그대로 둔다.
//   SUBDOCK   subId → mainId (연결: 연결선·읽기 전용 대화·메인과 함께 닫힘)
//   DOCK_FREE 사용자가 서브를 끌어 뗀 카드(연결은 유지, 자동 배치만 하지 않는다)
//   DOCK_OFF  사용자가 직접 닫은 서브(메인을 다시 열 때까지 자동으로 열지 않는다)
// 셋 다 localStorage 에 남겨 새로고침 뒤에도 같은 모습을 유지한다. 배치·이력은 BIGPOS 규칙을 그대로 쓴다.

const SUBDOCK = new Map();
const DOCK_FREE = new Set();
const DOCK_OFF = new Set();
const DOCK_GAP = 40;
const DOCK_ROWS = 3;

(function loadDock() {
  const v = readJSON("omp-map-subdock", {});
  const map = (v && v.map) || {};
  for (const [sub, main] of Object.entries(map)) {
    if (typeof sub === "string" && typeof main === "string" && sub !== main) SUBDOCK.set(sub, main);
  }
  for (const id of strList(v && v.off)) DOCK_OFF.add(id);
  for (const id of strList(v && v.free)) DOCK_FREE.add(id);
})();

const saveDock = () => writeJSON("omp-map-subdock", { map: Object.fromEntries(SUBDOCK), off: [...DOCK_OFF], free: [...DOCK_FREE] });

function sessionOf(id) {
  return DATA.sessions.find((s) => s.nodes.some((n) => n.id === id)) || null;
}

// 화면 노드(NODES)가 아직 갱신 전일 수 있으므로 스냅샷(DATA)을 먼저 본다.
function nodeInData(id) {
  const s = sessionOf(id);
  return (s && s.nodes.find((n) => n.id === id)) || nodeById(id) || null;
}

// 실행 중 판정: 스냅샷 상태(live) 또는 이 탭의 실시간 활동(마지막 턴 미종료). 서버가 끝났다고 한(done) 서브는 실시간 목록과 상관없이 끝난 것이다.
function subRunning(n) {
  if (!n || n.kind !== "sub") return false;
  if (n.status === "live") return true;
  if (n.status === "done") return false;
  try { return typeof actItems === "function" && actItems(n.id).running; } catch { return false; }
}

// 그 메인이 속한 세션의 실행 중 서브에이전트. 시작 순서대로.
function runningSubsOf(mainId) {
  const s = sessionOf(mainId);
  return !s ? [] : s.nodes
    .filter((n) => n.kind === "sub" && subRunning(n))
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || String(a.id).localeCompare(String(b.id)))
    .map((n) => n.id);
}

// 렌더마다(placeBigCards 앞): 열린 메인마다 실행 중 서브를 연결·자동으로 연다. 자동으로 붙인 서브가 완료되면 카드를 닫는다.
// 닫기 판정은 저장되는 SUBDOCK 이 기준이다 — 새로고침 뒤에도, 스냅샷 방송을 놓친 뒤에도 닫힌다. 손으로 연 완료 카드는 SUBDOCK 에 없으므로 유지된다.
function syncSubDocks() {
  let changed = false;
  const closed = [];
  for (const id of [...openIds]) {
    const n = nodeInData(id);
    if (!n) continue;
    if (n.kind === "sub") {
      if (!subRunning(n) && SUBDOCK.has(id)) { closeCard(id); closed.push(id); }   // 자동으로 붙인 서브가 끝났다 — 도킹·연결선·BIGPOS 정리 + DOCK_OFF
      continue;
    }
    if (n.kind !== "main") continue;
    for (const subId of runningSubsOf(id)) {
      if (DOCK_OFF.has(subId)) continue;
      if (SUBDOCK.get(subId) !== id) { SUBDOCK.set(subId, id); changed = true; }
      if (!openIds.has(subId)) { openIds.add(subId); changed = true; }
    }
  }
  // 열린 카드가 아닌 연결 기록은 정리한다(메인이 이미 닫힌 경우 등).
  for (const [subId, mainId] of [...SUBDOCK]) {
    if (openIds.has(subId) && openIds.has(mainId)) continue;
    SUBDOCK.delete(subId);
    DOCK_FREE.delete(subId);
    changed = true;
  }
  // 이번 렌더의 NODES 는 닫기 전에 만들어졌다 — 남겨 두면 접힌 카드가 한 번 그려진다.
  if (closed.length) NODES = NODES.filter((n) => !closed.includes(n.id));
  if (changed) { saveDock(); saveOpenCards(); }
}

// 렌더마다(SATS 확정 뒤): 연결된 서브 카드를 메인 오른쪽에 열 단위로 쌓는다. 옮겼으면 true.
function placeDocked() {
  const groups = new Map();
  for (const [subId, mainId] of SUBDOCK) {
    if (DOCK_FREE.has(subId) || !SATS.has(mainId) || !SATS.has(subId)) continue;
    if (!groups.has(mainId)) groups.set(mainId, []);
    groups.get(mainId).push(subId);
  }
  let moved = false;
  for (const [mainId, subs] of groups) {
    const m = SATS.get(mainId);
    const rows = Math.min(DOCK_ROWS, Math.ceil(subs.length / Math.ceil(subs.length / DOCK_ROWS)));
    const cols = Math.ceil(subs.length / rows);
    for (let c = 0; c < cols; c++) {
      const first = SATS.get(subs[c * rows]);
      const x = m.x + m.w + DOCK_GAP + c * (first.w + DOCK_GAP);
      let y = m.y;
      for (let r = 0; r < rows; r++) {
        const subId = subs[c * rows + r];
        if (!subId) break;
        const cur = SATS.get(subId);
        if (cur.x !== x || cur.y !== y) {
          SATS.set(subId, { ...cur, x, y });
          BIGPOS.set(subId, { ...(BIGPOS.get(subId) || { w: cur.w, h: cur.h }), x, y });
          moved = true;
        }
        y += cur.h + DOCK_GAP;
      }
    }
  }
  return moved;
}

// focusCluster 가 메인과 도킹된 서브를 한 화면에 맞추도록 자리를 모아 준다.
function dockFocusBoxes(mainId) {
  return [...SUBDOCK]
    .filter(([subId, main]) => main === mainId && !DOCK_FREE.has(subId) && SATS.has(subId))
    .map(([subId]) => SATS.get(subId));
}

// 메인 큰 카드를 끌 때 함께 움직일 도킹 서브 카드 엘리먼트.
function dockDragExtras(mainId) {
  const box = $("nodes"), out = [];
  for (const [subId, main] of SUBDOCK) {
    if (main !== mainId || DOCK_FREE.has(subId)) continue;
    const el = box.querySelector(`.node.big[data-id="${CSS.escape(subId)}"]`);
    if (el) out.push(itemOf(el));
  }
  return out;
}

// 큰 카드 끌기 직후: 서브를 직접 끌었으면 도킹을 풀어 그 자리에 고정한다(연결선은 유지).
function dockOnMoved(id) {
  if (SUBDOCK.has(id) && !DOCK_FREE.has(id)) { DOCK_FREE.add(id); saveDock(); }
}

// 큰 카드를 닫을 때: 메인이면 연결 서브를 함께 닫고, 서브면 자동 열림을 끈다.
function dockOnClose(id) {
  if (!id) return;
  let dirty = false;
  for (const [subId, mainId] of [...SUBDOCK]) {
    if (mainId !== id) continue;
    openIds.delete(subId); SATS.delete(subId);
    SUBDOCK.delete(subId); DOCK_FREE.delete(subId); DOCK_OFF.delete(subId);
    dirty = true;
  }
  if (SUBDOCK.delete(id)) { DOCK_FREE.delete(id); dirty = true; }
  const n = nodeInData(id);
  if (n && n.kind === "sub" && !DOCK_OFF.has(id)) { DOCK_OFF.add(id); dirty = true; }
  if (dirty) saveDock();
}

// 메인을 새로 열 때: 그 세션의 서브는 다시 자동으로 붙인다(직접 닫기·떼어 두기 초기화).
function dockOnOpen(mainId) {
  const s = sessionOf(mainId);
  if (!s) return;
  let dirty = false;
  for (const n of s.nodes) {
    if (n.kind !== "sub") continue;
    dirty = DOCK_OFF.delete(n.id) || dirty;
    dirty = DOCK_FREE.delete(n.id) || dirty;
  }
  if (dirty) saveDock();
}

function dockClassOf(id) {
  return SUBDOCK.has(id) ? "dock-sub" : "";
}

function dockTag(n) {
  if (!SUBDOCK.has(n.id) || !subRunning(n)) return "";   // 완료된 서브는 자동으로 닫히므로 살아 있는 연결만 표시한다
  return `<span class="docktag" title="메인 카드에 연결된 실행 중 서브에이전트">연결 · 실행 중</span>`;
}

// 연결 서브 카드의 대화 블록은 읽기 전용(입력·전송·비우기·압축 숨김).
const dockReadOnly = (id) => SUBDOCK.has(id);

// 메인 오른쪽 변 → 서브 왼쪽 변 곡선. 실행 중이면 움직이는 대시, 끝났으면 정적.
function dockEdgeHTML(S) {
  let out = "";
  for (const [subId, mainId] of SUBDOCK) {
    const a = S.big.get(mainId), b = S.big.get(subId);
    if (!a || !b) continue;
    const live = subRunning(nodeInData(subId));
    const stroke = live ? "#2fbf9b" : "#35506b";
    out += `<g class="docklink"><path class="dockedge${live ? " live" : ""}" d="${curveH(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2)}" fill="none" stroke="${stroke}" stroke-width="${live ? 2 : 1.4}"/>
      <circle cx="${a.x + a.w}" cy="${a.y + a.h / 2}" r="2.8" fill="${stroke}"/><circle cx="${b.x}" cy="${b.y + b.h / 2}" r="2.8" fill="${stroke}"/></g>`;
  }
  return out;
}
