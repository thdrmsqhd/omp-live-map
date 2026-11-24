/* omp-live-map · core · localStorage 읽기/쓰기 (MANUAL·LOCALS·HIDDEN·PINNED·CARD_BLOCKS·CARD_UI·ALIAS) */

const readJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};

const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const strList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string") : []);

// 삭제된 관심사 배치 기능이 남긴 키.
localStorage.removeItem("omp-map-groups");

// 지도에 남은 자동 배치 클러스터(HOST·인프라)의 저장 원점만 읽는다. 세션·카드 좌표(card:…)는 더 쓰지 않는다.
const storedManual = readJSON("omp-map-manual", {});
MANUAL = {};
for (const k of ["host", "infra"]) {
  const v = storedManual[k];
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) MANUAL[k] = { x: v.x, y: v.y };
}

const saveManual = () => writeJSON("omp-map-manual", MANUAL);

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

// 새 세션 창에서 마지막으로 고른 하네스("omp" 기본 / "claude").
let NEW_HARNESS = localStorage.getItem("omp-map-new-harness") || "omp";

const saveNewHarness = (h) => {
  NEW_HARNESS = h === "claude" ? "claude" : "omp";
  localStorage.setItem("omp-map-new-harness", NEW_HARNESS);
};

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

// 작은 세션 카드를 없애면서 쓰지 않게 된 키.
localStorage.removeItem("omp-map-subsize");
localStorage.removeItem("omp-map-layout-version");

// 배열 = 예전 전체 덮어쓰기 형식, 객체 = 기본값 대비 {add, remove} 형식. 둘 다 읽는다.
for (const [id, v] of Object.entries(readJSON("omp-map-blocks", {}))) {
  if (Array.isArray(v)) CARD_BLOCKS.set(id, strList(v));
  else if (v && typeof v === "object") CARD_BLOCKS.set(id, { add: strList(v.add), remove: strList(v.remove) });
}

const saveBlocks = () => writeJSON("omp-map-blocks", Object.fromEntries(CARD_BLOCKS));

// nodeId -> { collapsed: {type: true}, order: {main: [], side: []}, h: {type: px}, fit: {type: {w, h}} }
// fit = 블록을 더하며 카드를 키운 양. 블록을 빼면 그만큼 되돌린다(block-browser.js).
const CARD_UI = new Map();

for (const [id, v] of Object.entries(readJSON("omp-map-cardui", {}))) {
  if (!v || typeof v !== "object") continue;
  const collapsed = {};
  for (const [t, on] of Object.entries(v.collapsed || {})) if (on === true) collapsed[t] = true;
  const h = {};
  for (const [t, px] of Object.entries(v.h || {})) {
    if (Number.isFinite(px)) h[t] = Math.round(Math.min(BLOCK_H_MAX, Math.max(BLOCK_H_MIN, px)));
  }
  const fit = {};
  for (const [t, f] of Object.entries(v.fit || {})) {
    if (f && Number.isFinite(f.w) && Number.isFinite(f.h)) fit[t] = { w: Math.max(0, f.w), h: Math.max(0, f.h) };
  }
  const order = Object.fromEntries(["main", "side", "edit", "left"].map((slot) => [slot, strList(v.order?.[slot])]));
  const slots = Object.fromEntries(Object.entries(v.slots || {}).filter(([,slot]) => ["main","edit","side","left"].includes(slot)));
  const split = Number.isFinite(v.split) ? Math.max(25, Math.min(80, v.split)) : undefined;
  CARD_UI.set(id, { collapsed, order, h, fit, slots, split });
}

const saveCardUI = () => writeJSON("omp-map-cardui", Object.fromEntries(CARD_UI));

// 브라우저 블록 주소(nodeId·두 번째 인스턴스는 nodeId#browser#2 -> {url, local}).
for (const [k, v] of Object.entries(readJSON("omp-map-burls", {}))) {
  if (v && typeof v === "object") BURL.set(k, { url: String(v.url || ""), local: v.local === true });
}

const saveBrowserUrls = () => writeJSON("omp-map-burls", Object.fromEntries(BURL));

// DB 연결 프로필(nodeId -> [{name,type,host,port,database,user,path}]). 비밀번호는 저장하지 않는다.
const DBPROF = new Map();

for (const [id, list] of Object.entries(readJSON("omp-map-dbprofiles", {}))) {
  if (Array.isArray(list)) DBPROF.set(id, list.filter((p) => p && typeof p === "object"));
}

const saveDbProfiles = (id, list) => {
  if (list.length) DBPROF.set(id, list); else DBPROF.delete(id);
  writeJSON("omp-map-dbprofiles", Object.fromEntries(DBPROF));
};
