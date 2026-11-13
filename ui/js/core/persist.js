/* omp-live-map · core · localStorage 읽기/쓰기 (MANUAL·LOCALS·HIDDEN·PINNED·CARD_BLOCKS·CARD_UI·ALIAS) */

const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};

const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const strList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string") : []);

// 삭제된 관심사 배치 기능이 남긴 키.
localStorage.removeItem("omp-map-groups");

MANUAL = readJSON("omp-map-manual", {});

const saveManual = () => writeJSON("omp-map-manual", MANUAL);

// A안 카드 절대 좌표 전환 표식. "2" 가 아니면 기존 규칙으로 한 번 그린 뒤 그 좌표를 저장한다(commitLayout).
let LAYOUT_V2 = localStorage.getItem("omp-map-layout-version") === "2";

let layoutSaveWarned = false;

// 전환 직전 배치 저장값을 한 키에 백업한다. 중간 실패 뒤 다시 들어와도 처음 백업을 덮지 않는다.
function backupLayout() {
  if (localStorage.getItem("omp-map-layout-backup-v1") !== null) return;
  const raw = (k) => localStorage.getItem(k);
  writeJSON("omp-map-layout-backup-v1", { at: Date.now(), manual: raw("omp-map-manual"), bigpos: raw("omp-map-bigpos"), subsize: raw("omp-map-subsize"), open: raw("omp-map-open") });
}

// 렌더마다 한 번: 자리를 확정하지 않은 세션(전환 전에는 전부)은 원점과 보이는 카드 좌표를, 확정한 세션은 새 카드 좌표만 저장한다.
// 자동 배치는 이력(Ctrl+Z)에 넣지 않는다. 전환은 저장에 성공했을 때만 표식을 남긴다.
function commitLayout() {
  const migrating = !LAYOUT_V2;
  if (migrating && !CLUSTERS.some((c) => c.kind === "session")) return;   // 데이터가 오기 전에는 전환하지 않는다
  let dirty = false;
  for (const c of CLUSTERS) {
    if (c.kind !== "session") continue;
    if (!c.fixed) { MANUAL[c.key] = { x: c.ox, y: c.oy }; dirty = true; }
    for (const id of c.fixed ? c.fresh : c.members) {
      const g = geo.get(id);
      if (g) { MANUAL["card:" + id] = { x: g.x, y: g.y }; dirty = true; }
    }
  }
  if (!dirty) return;
  try {
    if (migrating) backupLayout();
    saveManual();
    if (!migrating) return;
    localStorage.setItem("omp-map-layout-version", "2");
    LAYOUT_V2 = true;
    for (const c of CLUSTERS) if (c.kind === "session") fitCluster(c);
  } catch (err) {
    console.error("layout save failed", err);
    if (migrating && !layoutSaveWarned) { layoutSaveWarned = true; alert("카드 배치 전환을 저장하지 못했습니다. 기존 배치로 계속 표시하며 다음 화면 갱신 때 다시 시도합니다."); }
  }
}

const storedLocals = readJSON("omp-map-locals", []);

LOCALS = (Array.isArray(storedLocals) ? storedLocals : []).map((l) => ({ ...l, cwd: String(l.cwd || "").replace(/^C:Users/, "C:/Users/") }));

const saveLocals = () => writeJSON("omp-map-locals", LOCALS);

function saveLocalsThrottled() {
  if (saveT) return;
  saveT = setTimeout(() => { saveT = 0; saveLocals(); }, 400);
}

HIDDEN = new Set(strList(readJSON("omp-map-hidden", [])));

const saveHidden = () => writeJSON("omp-map-hidden", [...HIDDEN]);

PINNED = new Set(strList(readJSON("omp-map-pinned", [])));

const savePinned = () => writeJSON("omp-map-pinned", [...PINNED]);
HIDE_DONE_SUBS = readJSON("omp-map-hide-done-subs", true) !== false;

const saveDoneSubs = () => writeJSON("omp-map-hide-done-subs", HIDE_DONE_SUBS);

for (const [id, name] of Object.entries(readJSON("omp-map-alias", {}))) {
  if (typeof name === "string" && name) ALIAS.set(id, name);
}

const saveAlias = () => writeJSON("omp-map-alias", Object.fromEntries(ALIAS));

for (const id of strList(readJSON("omp-map-open", []))) openIds.add(id);

for (const [id, box] of Object.entries(readJSON("omp-map-bigpos", {}))) {
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
  BIGPOS.set(id, {
    x: box.x, y: box.y,
    w: Number.isFinite(box.w) ? box.w : BIG_W,
    h: Number.isFinite(box.h) ? box.h : BIG_H,
  });
}

const saveOpenCards = () => {
  writeJSON("omp-map-open", [...openIds]);
  writeJSON("omp-map-bigpos", Object.fromEntries(BIGPOS));
};

// 작은 서브카드 크기(nodeId -> {w, h}). 열린 카드 크기는 BIGPOS 가 갖는다.
const SUBSIZE = new Map();

for (const [id, s] of Object.entries(readJSON("omp-map-subsize", {}))) {
  if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) SUBSIZE.set(id, { w: Math.max(180, s.w), h: Math.max(99, s.h) });
}

const saveSubSizes = () => writeJSON("omp-map-subsize", Object.fromEntries(SUBSIZE));

// 배열 = 예전 전체 덮어쓰기 형식, 객체 = 기본값 대비 {add, remove} 형식. 둘 다 읽는다.
for (const [id, v] of Object.entries(readJSON("omp-map-blocks", {}))) {
  if (Array.isArray(v)) CARD_BLOCKS.set(id, strList(v));
  else if (v && typeof v === "object") CARD_BLOCKS.set(id, { add: strList(v.add), remove: strList(v.remove) });
}

const saveBlocks = () => writeJSON("omp-map-blocks", Object.fromEntries(CARD_BLOCKS));

// nodeId -> { collapsed: {type: true}, order: {main: [], side: []}, h: {type: px} }
const CARD_UI = new Map();

for (const [id, v] of Object.entries(readJSON("omp-map-cardui", {}))) {
  if (!v || typeof v !== "object") continue;
  const collapsed = {};
  for (const [t, on] of Object.entries(v.collapsed || {})) if (on === true) collapsed[t] = true;
  const h = {};
  for (const [t, px] of Object.entries(v.h || {})) {
    if (Number.isFinite(px)) h[t] = Math.round(Math.min(400, Math.max(80, px)));
  }
  const order = { main: strList(v.order && v.order.main), side: strList(v.order && v.order.side) };
  CARD_UI.set(id, { collapsed, order, h });
}

const saveCardUI = () => writeJSON("omp-map-cardui", Object.fromEntries(CARD_UI));

// DB 연결 프로필(nodeId -> [{name,type,host,port,database,user,path}]). 비밀번호는 저장하지 않는다.
const DBPROF = new Map();

for (const [id, list] of Object.entries(readJSON("omp-map-dbprofiles", {}))) {
  if (Array.isArray(list)) DBPROF.set(id, list.filter((p) => p && typeof p === "object"));
}

const saveDbProfiles = (id, list) => {
  if (list.length) DBPROF.set(id, list); else DBPROF.delete(id);
  writeJSON("omp-map-dbprofiles", Object.fromEntries(DBPROF));
};
