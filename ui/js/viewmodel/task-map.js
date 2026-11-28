/* omp-live-map · viewmodel · 관제 벽의 상태: 프로젝트·Task 맵 데이터, 타일 순서·크기, 옮긴 카드 자리(타일별), 전체 화면 타일, 편집 중인 줄. 접기·펼치기 상태는 없다.
   화면 갱신은 viewUpdates.umap() 으로만 알린다(view 전역을 부르지 않는다). 데이터는 /api/engineering/* 를 그대로 쓴다.
   저장 키: omp-umap-wall-v1 { v: 1, order: [타일 key], sizes: { key: { w, h } } }(타일 순서·크기), omp-umap-manual-v2(옮긴 카드, 타일 캔버스 기준).
   예전 키(omp-umap-bands-v1 띠 순서·접힘, omp-umap-manual-v1 띠 기준 카드 자리, omp-umap-view-v1 한 맵 배율)는 읽지 않고 지운다 — 띠 좌표는 타일 안 좌표와 맞지 않는다. */

const UMAP_MANUAL_KEY = "omp-umap-manual-v2", UMAP_WALL_KEY = "omp-umap-wall-v1";
const UMAP_OLD_KEYS = ["omp-umap-bands-v1", "omp-umap-manual-v1", "omp-umap-view-v1"];
const UM = {
  projects: [], maps: new Map(), labels: new Map(), metrics: new Map(), definitions: new Map(), workflows: new Map(), presets: [],
  manual: {}, wall: { order: [], sizes: {} },
  adding: null, edit: null, current: "", signature: "", loaded: false, error: "",
  // view: 벽 이동·배율(저장하지 않는다 — 열 때마다 맨 위 100%). focus: 전체 화면으로 연 타일 key. scroll: 타일 본문 스크롤 자리(벽·전체 화면 따로).
  // autoFocus: 타일 본문을 마지막으로 자동 스크롤한 '지금 볼 곳' key(바뀌면 다시 그곳으로).
  view: { x: 0, y: 0, k: 1 }, focus: "", focusReturn: null, scroll: new Map(), autoFocus: new Map(),
  // stageScope: Task id → 단계를 제자리에서 고칠 때의 저장 범위('task' 이 Task만 · 'template' 템플릿). 기본은 이 Task만.
  stageScope: new Map(),
};
const umapScopeOf = (taskId) => UM.stageScope.get(taskId) || "task";
{
  const manual = readJSON(UMAP_MANUAL_KEY, {});
  for (const [key, spot] of Object.entries(manual && typeof manual === "object" ? manual : {})) {
    if (spot && typeof spot.band === "string" && Number.isFinite(spot.dx) && Number.isFinite(spot.dy)) UM.manual[key] = { band: spot.band, dx: spot.dx, dy: spot.dy };
  }
  UM.wall = umapReadWall(readJSON(UMAP_WALL_KEY, null));
  for (const key of UMAP_OLD_KEYS) if (localStorage.getItem(key) !== null) localStorage.removeItem(key);
}
// 저장 값 → { order, sizes }. 모양이 틀린 값·버전이 다른 값은 버린다.
function umapReadWall(saved) {
  const wall = { order: [], sizes: {} };
  if (!saved || typeof saved !== "object" || saved.v !== 1) return wall;
  wall.order = strList(saved.order);
  for (const [key, size] of Object.entries(saved.sizes && typeof saved.sizes === "object" ? saved.sizes : {})) {
    if (size && Number.isFinite(size.w) && Number.isFinite(size.h) && size.w >= 1 && size.h >= 1) wall.sizes[key] = { w: Math.round(size.w), h: Math.round(size.h) };
  }
  return wall;
}
const umapSaveWall = () => writeJSON(UMAP_WALL_KEY, { v: 1, order: UM.wall.order, sizes: UM.wall.sizes });
const umapNotify = () => viewUpdates.umap?.();

// 옮긴 카드 자리(그 타일 캔버스 기준). 저장하면 다음에 열어도 그 자리다.
function umapSetManual(key, band, dx, dy) {
  UM.manual[key] = { band, dx: Math.round(dx), dy: Math.round(dy) };
  writeJSON(UMAP_MANUAL_KEY, UM.manual);
}
function umapResetManual(key) {
  if (!(key in UM.manual)) return false;
  delete UM.manual[key];
  writeJSON(UMAP_MANUAL_KEY, UM.manual);
  return true;
}
function umapResetAllManual(band) {
  for (const key of Object.keys(UM.manual)) if (!band || UM.manual[key].band === band) delete UM.manual[key];
  writeJSON(UMAP_MANUAL_KEY, UM.manual);
}
const umapIsManual = (key) => key in UM.manual;

// 타일 순서(끌어 놓기 결과 전체 목록)·크기(격자 단위)를 저장한다. 되돌리기는 상태 순서·내용 크기로.
function umapWallSetOrder(keys) { UM.wall.order = strList(keys); umapSaveWall(); }
function umapWallSetSize(key, size) { UM.wall.sizes[key] = { w: Math.max(1, Math.round(size.w)), h: Math.max(1, Math.round(size.h)) }; umapSaveWall(); }
function umapWallResetSize(key) { if (!(key in UM.wall.sizes)) return false; delete UM.wall.sizes[key]; umapSaveWall(); return true; }
function umapWallReset() { UM.wall = { order: [], sizes: {} }; umapSaveWall(); }
// 자동 배치로 되돌리기 전에 떠 두고, 토스트의 '되돌리기'로 그대로 되살린다(옮긴 카드 · 타일 순서 · 타일 크기).
const umapLayoutSnapshot = () => JSON.parse(JSON.stringify({ manual: UM.manual, wall: UM.wall }));
const umapHasManualLayout = (band) => Object.values(UM.manual).some((spot) => !band || spot.band === band) || (!band && (UM.wall.order.length > 0 || Object.keys(UM.wall.sizes).length > 0));
function umapRestoreLayout(snapshot) {
  UM.manual = { ...(snapshot?.manual || {}) };
  UM.wall = umapReadWall({ v: 1, ...(snapshot?.wall || {}) });
  writeJSON(UMAP_MANUAL_KEY, UM.manual);
  umapSaveWall();
}

async function umapRequest(endpoint, params, payload) {
  const result = await window.engineeringApi.request(endpoint, params ?? {}, payload);
  if (!result.ok) throw new Error(result.error || "요청에 실패했습니다.");
  return result.value;
}

// 데이터 받기. full 이면 프로젝트 목록·칸 이름·Workflow·정의·지표까지 다시 받는다.
let umapBusy = null;
function umapRefresh(full = false) {
  if (umapBusy) return umapBusy;
  umapBusy = (async () => {
    try {
      if (full || !UM.loaded) {
        UM.projects = await umapRequest("projects");
        if (!UM.presets.length) UM.presets = await umapRequest("workflows/presets").catch(() => []);
      }
      const active = UM.projects.filter((project) => !project.archived);
      await Promise.all(active.map(async (project) => {
        const jobs = [umapRequest("task-map", { project: project.id }).then((map) => UM.maps.set(project.id, map))];
        if (full || !UM.labels.has(project.id)) {
          jobs.push(umapRequest("sdlc-stages", { project: project.id }).then((labels) => UM.labels.set(project.id, labels)).catch(() => {}));
          jobs.push(umapRequest("workflows", { project: project.id }).then((flows) => UM.workflows.set(project.id, flows)).catch(() => {}));
          jobs.push(umapLoadMetrics(project.id).catch(() => {}));
        }
        await Promise.all(jobs);
      }));
      for (const id of [...UM.maps.keys()]) if (!active.some((project) => project.id === id)) UM.maps.delete(id);
      UM.loaded = true;
      UM.error = "";
    } catch (error) { UM.error = error.message; }
    const signature = JSON.stringify([UM.error, UM.projects, [...UM.maps], [...UM.labels], [...UM.metrics], [...UM.workflows]]);
    if (signature !== UM.signature) { UM.signature = signature; umapNotify(); }
  })().finally(() => { umapBusy = null; });
  return umapBusy;
}
async function umapLoadMetrics(project) {
  const period = readJSON("omp-tasks-period", 7);
  const budget = (await umapRequest("project-budget", { project })).current;
  const dashboard = await umapRequest("workflow-dashboard", { project, days: budget?.days ?? period });
  UM.metrics.set(project, { budget, dashboard, days: budget?.days ?? period });
}
async function umapDefinitions(project, reload = false) {
  if (reload || !UM.definitions.has(project)) UM.definitions.set(project, await umapRequest("definitions", { project }));
  return UM.definitions.get(project);
}

// 스냅샷 세션의 sid(실행기 세션 id) → 세션 main 노드.
function umapSessionIndex() {
  const index = new Map();
  for (const session of DATA.sessions || []) for (const node of session.nodes || []) {
    if (node.kind === "main" && node.sid) index.set(node.sid, { ...node, session: session.key, sessionTitle: session.title });
  }
  return index;
}
// 세션 main 노드 → 에이전트 나무 항목(그 세션의 서브에이전트를 parent 로 이어 재귀로 단다). 노드마다 서버 활동 요약(act)이 실린다.
function umapAgentItem(node, session) {
  const nodes = session?.nodes || [], seen = new Set();
  const item = (n) => {
    seen.add(n.id);
    const kids = nodes.filter((child) => child.parent === n.id && child.kind !== "main" && !seen.has(child.id));
    return { id: n.id, node: n, lines: umapLinesOf(n), children: kids.map(item) };
  };
  return item(node);
}
// 카드 문장(model/agent-lines.js): 별칭·답 대기·하네스 이름은 여기서 넣는다(모델은 전역을 읽지 않는다).
const umapLinesOf = (n) => umapAgentLines(n, { alias: ALIAS.get(n.id) || "", ask: typeof askPending === "function" && Boolean(askPending(n.id)),
  harness: typeof capsOf === "function" ? capsOf(n).label : "" });
const umapSessionOf = (key) => (DATA.sessions || []).find((session) => session.key === key);
// 나무를 펼친 목록(맵 집계·개입 필요·테스트용).
const umapFlatItems = (items) => items.flatMap((entry) => [entry, ...umapFlatItems(entry.children || [])]);

// 맵에 그릴 띠 목록(배치 입력 + 그리는 데 쓸 데이터). sessions: 지금 필터를 지난 세션.
function umapBands(sessions) {
  const projects = UM.projects.filter((project) => !project.archived);
  const index = umapSessionIndex(), linked = new Set();
  const bands = new Map();
  for (const project of projects) {
    const key = "project:" + project.id, map = UM.maps.get(project.id);
    const tasks = umapOrderTasks(map?.tasks || []).map((task) => ({ ...task,
      stages: task.stages.map((stage) => ({ ...stage, sessions: stage.sessions.map((entry) => {
        const node = index.get(entry.sessionId);
        if (!node) return { id: "missing:" + entry.sessionId, node: null, entry, lines: null, children: [] };
        linked.add(node.id);
        return { ...umapAgentItem(node, umapSessionOf(node.session)), entry };
      }) })) }));
    for (const task of tasks) umapLinkBefore(task.stages);
    bands.set(key, { key, project, title: project.name, folder: project.root, tasks, free: [], sessions: [], labels: UM.labels.get(project.id) || [] });
  }
  for (const session of sessions) {
    const main = (session.nodes || []).find((node) => node.kind === "main");
    if (!main) continue;
    const folder = main.cwd || session.folder || "";
    const project = monitorProjectFor(folder, projects);
    const key = project ? "project:" + project.id : "folder:" + monitorPath(folder);
    if (!bands.has(key)) bands.set(key, { key, project: null, title: String(folder).split(/[\\/]/).filter(Boolean).pop() || "미분류", folder, tasks: [], free: [], sessions: [], labels: [] });
    const band = bands.get(key);
    band.sessions.push(session);
    if (linked.has(main.id)) continue;
    const node = { ...main, session: session.key, sessionTitle: session.title };
    const group = band.free.find((item) => item.folder === folder) || (band.free.push({ folder, sessions: [] }), band.free.at(-1));
    group.sessions.push(umapAgentItem(node, session));
  }
  // 단계에 이어진 세션이 지금 필터 밖이어도 그 띠의 집계에는 넣는다.
  for (const band of bands.values()) for (const task of band.tasks) for (const stage of task.stages) for (const item of stage.sessions) {
    if (item.node && !band.sessions.some((session) => session.key === item.node.session)) {
      const session = (DATA.sessions || []).find((entry) => entry.key === item.node.session);
      if (session) band.sessions.push(session);
    }
  }
  const list = [...bands.values()];
  for (const band of list) band.adding = UM.adding?.band === band.key;
  return list;
}

// 쉬는 타일에 보일 최근 끝난 일(최근 것부터 n개): 끝난 Task 실행과 Task 에 묶이지 않은 세션.
// { kind: 'task'|'session', title, status, done, total, result, legacy, at } — 문구(상태 이름·언제)는 화면이 붙인다.
function umapRecentDone(band, n = 3) {
  const linked = new Set(band.tasks.flatMap((task) => task.stages.flatMap((stage) => stage.sessions.map((item) => item.node?.id).filter(Boolean))));
  const tasks = band.tasks.filter((task) => task.run && !["running", "queued"].includes(task.run.status)).map((task) => ({
    kind: "task", title: umapPlain(task.title), status: task.run.status, done: task.stages.filter(({ status }) => status === "succeeded").length,
    total: task.stages.length, result: task.run.legacy ? "" : umapClip(task.run.error || "", 120), legacy: Boolean(task.run.legacy), at: task.run.updated || task.updated || 0 }));
  const sessions = [];
  for (const session of band.sessions) {
    const main = (session.nodes || []).find((node) => node.kind === "main");
    if (!main || linked.has(main.id)) continue;
    const lines = umapLinesOf({ ...main, sessionTitle: session.title });
    const summary = umapClip(main.act?.resultSummary || "", 120);
    sessions.push({ kind: "session", title: lines.title, status: lines.state, result: summary || lines.result || (lines.goal ? "지시 · " + lines.goal : ""), at: session.lastTs || 0 });
  }
  return [...tasks, ...sessions].sort((a, b) => b.at - a.at).slice(0, n);
}

// 승인 단계는 무엇을 승인하는지 카드에서 바로 보이게 앞 단계의 결과 한 줄을 싣는다: { label, status, result }.
// 결과 = 앞 단계 최근 세션의 결과 요약 → 그 단계 오류 → (없으면 화면이 상태 이름을 쓴다).
function umapLinkBefore(stages) {
  for (const [index, stage] of stages.entries()) {
    if (stage.status !== "waiting_approval" || !index) continue;
    const prev = stages[index - 1], lead = [...prev.sessions].reverse().find((item) => item.node);
    const summary = lead?.node.act?.resultSummary ? umapClip(lead.node.act.resultSummary, 140) : "";
    stage.before = { label: prev.label, status: prev.status, result: summary || prev.error || "" };
  }
}

// 타일 상태(관제 벽의 순서·테두리·크기): attention(승인 대기·보류/실패·답 필요) → running(도는 Task·세션) → idle(그 밖).
// 돌려주는 값: Map key → { state, at(최근 활동 ms), attention: [umapAttention 항목] }
function umapTileStates(bands) {
  const attention = umapAttention(bands), out = new Map();
  for (const band of bands) {
    const items = umapFlatItems([...band.tasks.flatMap((task) => task.stages.flatMap((stage) => stage.sessions)), ...band.free.flatMap((group) => group.sessions)]);
    const mine = attention.filter((item) => item.band === band.key);
    const running = band.tasks.some((task) => task.status === "running" || ["running", "queued"].includes(task.run?.status))
      || items.some((item) => item.lines?.state === "running");
    const at = Math.max(0, ...band.tasks.map((task) => Math.max(task.updated || 0, task.run?.updated || 0)), ...band.sessions.map((session) => session.lastTs || 0));
    out.set(band.key, { state: mine.length ? "attention" : running ? "running" : "idle", at, attention: mine });
  }
  return out;
}

// 세션 폴더 → 띠 키(프로젝트면 project:<id>, 아니면 folder:<경로>).
function umapBandKeyFor(folder) {
  const project = monitorProjectFor(folder, UM.projects.filter((item) => !item.archived));
  return project ? "project:" + project.id : "folder:" + monitorPath(folder);
}

// '개입 필요': 승인을 기다리는 단계 → 보류(실패) Task → 답을 기다리는 세션 순서.
function umapAttention(bands) {
  const out = [];
  for (const band of bands) for (const task of band.tasks) {
    const waiting = task.stages.find((stage) => stage.status === "waiting_approval");
    if (waiting) out.push({ key: umapStageKey(task.id, waiting.id), band: band.key, label: task.title + " · " + waiting.label + (waiting.label.includes("승인") ? " 대기" : " 승인 대기") });
    else if (task.status === "blocked") {
      // 실패한 실행은 실패한 단계로, 그 밖의 보류는 Task 카드로 옮긴다.
      const failed = task.run?.status === "failed" && task.stages.find((stage) => stage.status === "failed");
      out.push(failed ? { key: umapStageKey(task.id, failed.id), band: band.key, label: task.title + " · " + failed.label + " 실패" }
        : { key: umapTaskKey(task.id), band: band.key, label: task.title + (task.run?.status === "failed" ? " · 실패" : " · 보류") });
    }
  }
  for (const band of bands) {
    const items = [...band.tasks.flatMap((task) => task.stages.flatMap((stage) => stage.sessions)), ...band.free.flatMap((group) => group.sessions)];
    for (const item of umapFlatItems(items)) {
      if (item.node && askPending(item.node.id)) out.push({ key: umapSessionKey(item.id), band: band.key, label: (ALIAS.get(item.node.id) || item.node.sessionTitle || item.node.title || item.node.name) + " · 답 필요" });
    }
  }
  return out;
}
