/* omp-live-map · viewmodel · 한 맵의 상태: 프로젝트·Task 맵 데이터, 띠 순서, 옮긴 카드 자리, 편집 중인 줄. 접기·펼치기 상태는 없다.
   화면 갱신은 viewUpdates.umap() 으로만 알린다(view 전역을 부르지 않는다). 데이터는 /api/engineering/* 를 그대로 쓴다. */

const UMAP_MANUAL_KEY = "omp-umap-manual-v1", UMAP_BANDS_KEY = "omp-umap-bands-v1", UMAP_VIEW_KEY = "omp-umap-view-v1";
const UM = {
  projects: [], maps: new Map(), labels: new Map(), metrics: new Map(), definitions: new Map(), workflows: new Map(), presets: [],
  manual: {}, order: [],
  adding: null, edit: null, current: "", signature: "", loaded: false, error: "",
  view: { x: 40, y: 24, k: 1 },
};
{
  const manual = readJSON(UMAP_MANUAL_KEY, {});
  for (const [key, spot] of Object.entries(manual && typeof manual === "object" ? manual : {})) {
    if (spot && typeof spot.band === "string" && Number.isFinite(spot.dx) && Number.isFinite(spot.dy)) UM.manual[key] = { band: spot.band, dx: spot.dx, dy: spot.dy };
  }
  const bands = readJSON(UMAP_BANDS_KEY, {});
  UM.order = strList(bands?.order);
  // 예전 저장 값의 띠 접힘(collapsed)은 읽지 않고 지운다(접기는 없어졌다).
  if (bands && typeof bands === "object" && "collapsed" in bands) writeJSON(UMAP_BANDS_KEY, { order: UM.order });
  const saved = readJSON(UMAP_VIEW_KEY, null);
  if (saved && [saved.x, saved.y, saved.k].every(Number.isFinite)) UM.view = { x: saved.x, y: saved.y, k: Math.min(2, Math.max(0.2, saved.k)) };
}
const umapSaveBands = () => writeJSON(UMAP_BANDS_KEY, { order: UM.order });
const umapSaveView = () => writeJSON(UMAP_VIEW_KEY, UM.view);
const umapNotify = () => viewUpdates.umap?.();

// 옮긴 카드 자리(띠 원점 기준). 저장하면 다음에 열어도 그 자리다.
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

// 띠를 위·아래로 한 칸 옮긴다. keys: 지금 화면 순서.
function umapMoveBand(key, delta, keys) {
  const order = [...keys];
  const from = order.indexOf(key), to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return false;
  order.splice(from, 1);
  order.splice(to, 0, key);
  UM.order = order;
  umapSaveBands();
  return true;
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
  const ordered = umapOrderBands([...bands.values()], UM.order);
  for (const band of ordered) band.adding = UM.adding?.band === band.key;
  return ordered;
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
    if (waiting) out.push({ key: umapStageKey(task.id, waiting.id), band: band.key, label: task.title + " · " + waiting.label + " 승인" });
    else if (task.status === "blocked") out.push({ key: umapTaskKey(task.id), band: band.key, label: task.title + " · 보류" });
  }
  for (const band of bands) {
    const items = [...band.tasks.flatMap((task) => task.stages.flatMap((stage) => stage.sessions)), ...band.free.flatMap((group) => group.sessions)];
    for (const item of umapFlatItems(items)) {
      if (item.node && askPending(item.node.id)) out.push({ key: umapSessionKey(item.id), band: band.key, label: (ALIAS.get(item.node.id) || item.node.sessionTitle || item.node.title || item.node.name) + " · 답 필요" });
    }
  }
  return out;
}
