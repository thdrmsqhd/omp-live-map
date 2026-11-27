/* omp-live-map · viewmodel · 한 맵의 명령: Task 만들기·실행·옮기기·고치기, 단계 고치기(범위), Workflow 편집, 승인·반려.
   모두 서버 API(/api/engineering/*)를 부른 뒤 그 프로젝트의 Task 맵을 다시 받아 viewUpdates.umap() 으로 알린다. */

const UMAP_FLOW_KEY = "omp-tasks-flow";
const umapRunKeys = new Map();

// 폴더 띠(아직 프로젝트가 아님)에서 Task 를 만들면 그 폴더를 프로젝트로 만든다(projects/ensure).
async function umapEnsureProject(band) {
  if (band.project) return band.project.id;
  const project = await umapRequest("projects/ensure", {}, { root: band.folder });
  await umapRefresh(true);
  return project.id;
}

// Workflow 칩 선택지: 템플릿(preset:) + 이 프로젝트의 저장 Workflow(flow:, 템플릿 사본·자동 사본 제외).
function umapFlowOptions(project) {
  const flows = UM.workflows.get(project) || [];
  const presetNames = new Set(UM.presets.map(({ name }) => name));
  return [
    ...UM.presets.map((preset) => ({ value: "preset:" + preset.id, name: preset.name, title: preset.summary, group: "템플릿" })),
    ...flows.filter(({ generated, name }) => !generated && !presetNames.has(name) && !/ · Task [0-9a-f-]{8}$/.test(name))
      .map((flow) => ({ value: "flow:" + flow.id, name: flow.name, title: "", group: "저장된 Workflow", id: flow.id, version: flow.version })),
  ];
}
function umapLastFlow(project) {
  const saved = readJSON(UMAP_FLOW_KEY, "");
  return umapFlowOptions(project).some(({ value }) => value === saved) ? saved : "preset:feature";
}

async function umapCreateTask(band, text, value, run) {
  const project = await umapEnsureProject(band);
  const option = umapFlowOptions(project).find((item) => item.value === value);
  const body = value.startsWith("preset:") ? { project, text, template: value.slice(7) } : { project, text, workflow: option?.id, version: option?.version };
  const task = await umapRequest("tasks", {}, body);
  writeJSON(UMAP_FLOW_KEY, value);
  UM.workflows.set(project, await umapRequest("workflows", { project }).catch(() => UM.workflows.get(project) || []));
  await umapRefreshProject(project);
  if (run) await umapRunTask({ ...task, project });
  return task;
}
async function umapRefreshProject(project) {
  UM.maps.set(project, await umapRequest("task-map", { project }));
  UM.signature = "";
  umapNotify();
}
const umapProjectOf = (taskId) => [...UM.maps].find(([, map]) => map.tasks.some(({ id }) => id === taskId))?.[0] ?? null;
const umapTaskById = (taskId) => UM.maps.get(umapProjectOf(taskId))?.tasks.find(({ id }) => id === taskId) ?? null;

// ▶: 실행 환경을 확인하고(없으면 묻는다) 그 Task 의 Workflow 를 돌린다. 같은 누르기는 같은 키로 한 번만 시작한다.
async function umapRunTask(task) {
  const runtime = await umapRequest("runtime").catch(() => null);
  if (runtime && runtime.status !== "ready" && !window.confirm((runtime.detail || "실행 환경을 확인하지 못했습니다.") + "\n\n그래도 실행할까요?")) return null;
  const key = umapRunKeys.get(task.id) ?? crypto.randomUUID();
  umapRunKeys.set(task.id, key);
  const run = await umapRequest("tasks/run", {}, { id: task.id, key });
  umapRunKeys.delete(task.id);
  await umapRefreshProject(umapProjectOf(task.id) ?? task.project);
  return run;
}

// Task 본문·한도·예산·제목. 최신 리비전으로 보낸다.
async function umapSaveTask(taskId, patch) {
  const project = umapProjectOf(taskId), task = umapTaskById(taskId);
  const saved = await umapRequest("tasks", {}, { project, id: taskId, revision: task.revision, ...patch });
  Object.assign(task, { revision: saved.revision, title: saved.title, instruction: saved.instruction });
  await umapRefreshProject(project);
  return saved;
}
async function umapMoveTask(taskId, status) {
  const task = umapTaskById(taskId);
  await umapRequest("tasks/move", {}, { id: taskId, status, revision: task.revision });
  await umapRefreshProject(umapProjectOf(taskId));
}

// 서랍의 단계·하네스·루프 고치기. scope: "task"(이 Task만, 기본) | "template".
async function umapEditStage(taskId, node, scope, patch) {
  const result = await umapRequest("tasks/stage", {}, { task: taskId, node, scope, ...patch });
  const project = umapProjectOf(taskId);
  UM.workflows.set(project, await umapRequest("workflows", { project }).catch(() => UM.workflows.get(project) || []));
  UM.definitions.delete(project);
  await umapRefreshProject(project);
  return result;
}

// Workflow 편집 모드: 지금 단계 id 순서(stages) + 새 단계 설명(added)을 그대로 저장한다.
function umapStartEdit(taskId) {
  const task = umapTaskById(taskId);
  UM.edit = { task: taskId, ids: task.stages.map(({ id }) => id), added: {}, scope: "task", status: "" };
  UM.expanded.add(umapTaskKey(taskId));
  umapNotify();
}
function umapStopEdit() { UM.edit = null; umapNotify(); }
async function umapSaveEdit(ids) {
  const edit = UM.edit;
  if (!edit) return;
  const previous = edit.ids;
  edit.ids = ids;
  edit.status = "저장 중…";
  umapNotify();
  try {
    await umapRequest("tasks/workflow", {}, { task: edit.task, scope: edit.scope,
      stages: ids.map((id) => edit.added[id] ? { id, ...edit.added[id] } : { id }) });
    edit.status = "저장됨 · " + (edit.scope === "template" ? "템플릿" : "이 Task만");
    edit.added = Object.fromEntries(Object.entries(edit.added).filter(([id]) => ids.includes(id)));
    const project = umapProjectOf(edit.task);
    UM.workflows.set(project, await umapRequest("workflows", { project }).catch(() => UM.workflows.get(project) || []));
    await umapRefreshProject(project);
    const task = umapTaskById(edit.task);
    if (task && UM.edit === edit) edit.ids = task.stages.map(({ id }) => id);
  } catch (error) {
    edit.ids = previous;
    edit.status = error.message;
    umapNotify();
  }
}
function umapNewStageId(kind) {
  const taken = new Set(UM.edit?.ids || []);
  let index = 1;
  while (taken.has(kind + "-" + index)) index++;
  return kind + "-" + index;
}

// 승인 단계의 승인·반려(반려는 이유가 필요하다).
async function umapDecide(runId, node, decision, reason) {
  await umapRequest("workflow-runs/approval", {}, { id: runId, node, decision, ...(reason ? { reason } : {}) });
  for (const [project, map] of UM.maps) if (map.tasks.some((task) => task.run?.id === runId)) await umapRefreshProject(project);
}
async function umapRunAction(runId, operation) {
  await umapRequest("workflow-runs/action", {}, { id: runId, operation });
  for (const [project, map] of UM.maps) if (map.tasks.some((task) => task.run?.id === runId)) await umapRefreshProject(project);
}
async function umapRetry(runId, node) {
  await umapRequest("workflow-runs/retry", {}, { id: runId, node });
  for (const [project, map] of UM.maps) if (map.tasks.some((task) => task.run?.id === runId)) await umapRefreshProject(project);
}

// 띠 머리의 칸 이름(상태 이름)·예산·기간.
async function umapRenameStatus(project, status, label) {
  UM.labels.set(project, await umapRequest("sdlc-stages", {}, { project, status, label }));
  umapNotify();
}
async function umapAddStatus(project) {
  UM.labels.set(project, await umapRequest("sdlc-stages/add", {}, { project, label: "새 상태" }));
  umapNotify();
}
async function umapRemoveStatus(project, status) {
  UM.labels.set(project, await umapRequest("sdlc-stages/remove", {}, { project, status }));
  await umapRefreshProject(project);
}
async function umapSaveBudget(project, cap, days) {
  if (cap === null) await umapRequest("project-budget", {}, { project, remove: true });
  else await umapRequest("project-budget", {}, { project, cap, days });
  await umapLoadMetrics(project);
  umapNotify();
}
async function umapSavePeriod(project, days) {
  writeJSON("omp-tasks-period", days);
  const current = UM.metrics.get(project)?.budget;
  if (current) await umapRequest("project-budget", {}, { project, cap: current.cap, days });
  await umapLoadMetrics(project);
  umapNotify();
}
