/* omp-live-map · viewmodel · 서브에이전트 도킹 상태와 실행 중 판정 */
// 메인 카드를 열면 그 세션에서 실행 중인 서브에이전트 카드가 오른쪽에 세로로 붙는다(배치·그리기는 view/sub-dock.js).
//   SUBDOCK   subId → mainId (연결: 연결선·읽기 전용 대화·메인과 함께 닫힘)
//   DOCK_FREE 사용자가 서브를 끌어 뗀 카드(연결은 유지, 자동 배치만 하지 않는다)
//   DOCK_OFF  사용자가 직접 닫은 서브(메인을 다시 열 때까지 자동으로 열지 않는다)
// 셋 다 localStorage 에 남겨 새로고침 뒤에도 같은 모습을 유지한다.

const SUBDOCK = new Map();
const DOCK_FREE = new Set();
const DOCK_OFF = new Set();

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
  return GRAPH_NODES.get(id)?.session || null;
}

// 화면 노드(NODES)가 아직 갱신 전일 수 있으므로 스냅샷(DATA)을 먼저 본다.
function nodeInData(id) {
  return GRAPH_NODES.get(id)?.node || nodeById(id) || null;
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

// 연결 서브 카드의 대화 블록은 읽기 전용(입력·전송·비우기·압축 숨김).
const dockReadOnly = (id) => SUBDOCK.has(id);
