import { bindSessionHarnesses } from "./session-harnesses.js";
import { harnessProvenance } from "./harness-provenance.js";
import { bindDefinitionEditor } from "./engineering-definitions.js";
import { bindRuntimeControls } from "./engineering-runtime.js";
import { bindWorkflow } from "./workflow-editor.js";
import { bindSdlc } from "./sdlc.js";
import { loadModelOptions } from "./engineering-model-options.js";
import { bindStudio } from "./studio.js";

const find = (id) => document.getElementById(id);
const status = find("status");
const project = find("project");
const loop = find("loop");
const runs = find("runs");
const scopeButtons = [...document.querySelectorAll("[data-definition-scope]")];
const teamPicker = find("definition-team");
const kind = find("kind");
let scope = "personal";
let scopedDefinitions = [];
let loopHarnesses = [];
let scopedDefinitionsStale = false;
let scopeRequest = 0;
let projectRequest = 0;
let definitions = [];
let projects = [];
let modelOptions = [];
let currentRunRequest = null;
let workflow;
let sdlc;
let studio;
let activeView = "studio";
let starterRefs;
const starter = find("setup-defaults");
const starterStatus = find("setup-starter-status");
let creatingDefaults = false;

async function request(endpoint, params, payload) {
  if (!window.engineeringDesktop) throw new Error("데스크톱 앱에서 Engineering을 열어 주세요.");
  const result = await window.engineeringDesktop.request(endpoint, params, payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function report(work) {
  return async (event) => {
    event?.preventDefault();
    status.textContent = "";
    try { await work(event); } catch (error) { status.textContent = error.message; }
  };
}

function options(control, values, first, chosen = control.value) {
  control.replaceChildren(new Option(first, ""));
  for (const entry of values) control.add(new Option(entry.name, entry.id));
  if ([...control.options].some((option) => option.value === chosen)) control.value = chosen;
}

function owner() {
  const selected = projects.find(({ id }) => id === project.value);
  if (scope === "personal") return { scope, label: "개인 · 내 하네스", ready: true };
  if (scope === "team") return { scope, team: teamPicker.value, label: "팀 · " + teamPicker.value, ready: Boolean(teamPicker.value) };
  return { scope, project: selected?.id, label: "프로젝트 · " + selected?.name, ready: Boolean(selected), archived: selected?.archived };
}

function canPreview() {
  const selected = projects.find(({ id }) => id === project.value);
  return Boolean(selected && (scope !== "team" || selected.team === teamPicker.value));
}

function setScope(value) {
  scope = value;
  for (const button of scopeButtons) button.setAttribute("aria-pressed", String(button.dataset.definitionScope === scope));
  updateProjectContext();
}

function updateProjectContext() {
  find("engineering-context").hidden = !["studio", "workflow", "sdlc", "execution"].includes(activeView) &&
    !(scope === "project" && ["design", "loop"].includes(activeView));
}

const editor = bindDefinitionEditor({
  find, request, report, options, definitions: () => scopedDefinitions, refreshDefinitions: refreshEditor,
  owner, canPreview,
  models: () => modelOptions,
  availableHarnesses: () => loopHarnesses.filter(({ kind }) => kind === "harness")
    .map((entry) => ({ ...entry, name: engineeringDefinitionLabel(entry) })),
  openScope(id) {
    const record = definitions.find((entry) => entry.id === id && entry.kind === "harness");
    if (!record) throw new Error("이 작업 프로젝트에서 사용할 수 있는 하네스를 선택해 주세요.");
    setScope(record.scope);
    if (record.team) teamPicker.value = record.team;
  },
});

async function refreshEditor(chosen, refreshAvailable = false) {
  const destination = owner();
  const { scope, project: projectId, team, label, ready, archived } = destination;
  const revision = ++scopeRequest;
  const type = kind.value;
  find("definition-heading").textContent = { harness: "Workflow 하네스", model: "하네스에 연결할 모델", loop: "워크플로 루프" }[type];
  find("definition-guide").textContent = {
    harness: "역할, 작업 지시, 적용할 모델과 스킬을 저장합니다. 저장한 하네스를 Workflow 또는 루프에 연결할 수 있습니다.",
    model: "아래 목록에서 모델을 골라 현재 저장 범위에 등록합니다.",
    loop: "하네스를 실행하고 검증 결과에 따라 다시 시도하는 규칙을 저장합니다.",
  }[type];
  find("definition-list-label").textContent = { harness: "저장된 하네스", model: "저장된 모델", loop: "저장된 루프" }[type];
  find("definition-new").textContent = { harness: "새 하네스", model: "새 모델", loop: "새 루프" }[type];
  find("definition-new").disabled = Boolean(archived);
  find("definition-team-field").hidden = scope !== "team";
  find("definition-team-settings").hidden = scope !== "team";
  find("definition-model-open").hidden = type !== "harness";
  find("definition-harness-open").hidden = type !== "model";
  const content = find("definition-content");
  content.disabled = true;
  content.hidden = !ready;
  find("definition-owner").textContent = ready ? "저장 위치 · " + label + (archived ? " (보관됨)" : "") :
    scope === "team" ? "저장할 팀을 선택하거나 새 팀을 등록하세요." :
      "위에서 작업 프로젝트를 선택하세요.";
  const selectedId = project.value;
  const [records, available, supportedModels, personal] = await Promise.all([
    ready ? request("definitions", { scope, ...(projectId ? { project: projectId } : {}), ...(team ? { team } : {}) }) : [],
    refreshAvailable && selectedId ? request("definitions", { project: selectedId }) : null,
    type === "model" && ready ? loadModelOptions() : null,
    type === "loop" && ready && scope === "team" ? request("definitions", { scope: "personal" }) : [],
  ]);
  if (available && selectedId === project.value) showAvailable(available);
  if (revision !== scopeRequest) return;
  if (supportedModels) modelOptions = supportedModels.engineering;
  scopedDefinitions = records;
  loopHarnesses = type === "loop" && scope === "project" ? definitions : [...records, ...personal];
  scopedDefinitionsStale = false;
  content.disabled = !ready;
  editor.select(chosen);
}

function showAvailable(records) {
  definitions = records;
  options(loop, definitions.filter((entry) => entry.kind === "loop")
    .map((entry) => ({ id: entry.id, name: engineeringDefinitionLabel(entry) })), "루프 선택");
  workflow?.refreshProfiles();
}

function updateStarter(message) {
  starter.disabled = !window.engineeringDesktop || creatingDefaults;
  starterStatus.hidden = !message;
  starterStatus.textContent = message ?? "";
}

async function addWorkflowDefaults() {
  starterRefs = await request("workflows/presets/defaults", {}, { scope: "personal" });
  scopedDefinitionsStale = true;
  const selectedId = project.value;
  if (selectedId) {
    const records = await request("definitions", { project: selectedId });
    if (selectedId === project.value) {
      showAvailable(records);
      workflow?.useDefaults(selectedId, starterRefs);
    }
  }
}

async function refreshProjects(chosen, editSelected = false) {
  const revision = ++projectRequest;
  const [records, teams] = await Promise.all([request("projects"), request("teams")]);
  if (revision !== projectRequest) return;
  projects = records;
  options(project, projects.map((entry) => ({ id: entry.id, name: entry.name + (entry.archived ? " (보관됨)" : "") })), "프로젝트 선택", chosen);
  const selected = projects.find((entry) => entry.id === project.value);
  options(teamPicker, teams.map((name) => ({ id: name, name })), "팀 선택", teamPicker.value || selected?.team);
  find("known-teams").replaceChildren(...teams.map((name) => new Option(name, name)));
  if (editSelected) {
    const form = find("project-form");
    form.elements.name.value = selected?.name ?? "";
    form.elements.root.value = selected?.root ?? "";
    form.elements.branch.value = selected?.branch ?? "";
    form.elements.team.value = selected?.team ?? "";
    form.dataset.project = selected?.id ?? "";
  }
  find("archive").disabled = !selected || selected.archived;
  const available = selected ? await request("definitions", { project: selected.id }) : [];
  if (revision !== projectRequest) return;
  showAvailable(available);
  await Promise.all([
    refreshEditor(),
    studio?.selectProject(selected?.id ?? "", selected),
    workflow?.selectProject(selected?.id ?? "", Boolean(selected?.archived)),
    sdlc?.selectProject(selected?.id ?? ""),
    refreshRuns(),
  ]);
  if (revision === projectRequest && selected && starterRefs) workflow?.useDefaults(selected.id, starterRefs);
}

for (const button of scopeButtons) button.addEventListener("click", report(async () => {
  const next = button.dataset.definitionScope;
  if (scope === next || !editor.mayReplace()) return;
  setScope(next);
  await refreshEditor("");
}));
teamPicker.addEventListener("change", report(async () => {
  if (editor.mayReplace(teamPicker)) await refreshEditor("");
}));
find("definition-team-form").onsubmit = report(async (event) => {
  if (!editor.mayReplace()) return;
  const form = event.currentTarget;
  const team = await request("teams", {}, formValues(event));
  const teams = await request("teams");
  options(teamPicker, teams.map((name) => ({ id: name, name })), "팀 선택", team);
  find("known-teams").replaceChildren(...teams.map((name) => new Option(name, name)));
  form.reset();
  find("definition-team-settings").open = false;
  if (scope === "team") await refreshEditor("");
});

async function refreshRuns(chosen) {
  const id = project.value;
  const records = id ? await request("runs", { project: id }) : [];
  if (id !== project.value) return;
  options(runs, records.map((run) => ({ id: run.id, name: `${run.title} · ${run.status}` })), "실행 선택", chosen);
  const selected = runs.value;
  const detail = selected ? await request("run", { id: selected }) : null;
  if (selected !== runs.value) return;
  find("run-summary").textContent = detail ? `${detail.run.status} · ${detail.blockedReason ?? detail.run.workspace ?? "작업 공간 없음"}` : "";
  find("attempts").replaceChildren(...(detail?.attempts ?? []).map((attempt) => {
    const line = document.createElement("li");
    const output = document.createElement("pre");
    output.textContent = JSON.stringify(attempt.outcome, null, 2);
    line.append(`시도 ${attempt.number} · ${attempt.status}`);
    const source = harnessProvenance(attempt.outcome?.definitions, attempt.outcome ? [attempt.outcome] : []);
    if (source) line.append(source);
    line.append(output);
    return line;
  }));
}

function formValues(event) {
  return Object.fromEntries(new FormData(event.currentTarget));
}

find("project-form").addEventListener("input", (event) => {
  if (event.target.name === "root") event.currentTarget.dataset.project = "";
});
find("project-form").addEventListener("submit", report(async (event) => {
  if (!editor.mayReplace()) return;
  const values = formValues(event);
  const saved = await request("projects", {}, { ...values, id: event.currentTarget.dataset.project || undefined });
  await refreshProjects(saved.id, true);
}));
project.addEventListener("change", report(async () => {
  if (studio && !studio.mayReplace()) {
    project.value = studio.projectId();
    return;
  }
  if (editor.mayReplace(project)) await refreshProjects(project.value, true);
}));
find("archive").addEventListener("click", report(async () => {
  if (!editor.mayReplace()) return;
  await request("projects/archive", {}, { id: project.value });
  await refreshProjects(project.value, true);
}));
find("run-form").addEventListener("submit", report(async (event) => {
  const values = { ...formValues(event), project: project.value };
  const input = JSON.stringify(values);
  if (currentRunRequest?.input !== input) currentRunRequest = { input, key: crypto.randomUUID() };
  const run = await request("runs", {}, { ...values, key: currentRunRequest.key });
  currentRunRequest = null;
  await refreshRuns(run.id);
}));
runs.addEventListener("change", report(async () => refreshRuns()));
find("actions").addEventListener("click", report(async (event) => {
  if (event.target.dataset.operation && runs.value) {
    await request("runs/action", {}, { id: runs.value, operation: event.target.dataset.operation });
    await refreshRuns();
  }
}));
const views = ["studio", "setup", "design", "workflow", "session-harnesses", "sdlc", "execution"];
const loadSessionHarnesses = bindSessionHarnesses(find);
const profileDialog = find("workflow-profile-dialog");
const profileEditor = find("session-harness-editor");
find("workflow-open-profiles").onclick = () => {
  find("workflow-profile-host").append(profileEditor);
  profileDialog.showModal();
  void loadSessionHarnesses();
};
find("workflow-close-profiles").onclick = () => profileDialog.close();
profileDialog.addEventListener("close", () => find("session-harness-host").append(profileEditor));
function showView(view, freshProfile = false) {
  activeView = view;
  updateProjectContext();
  if (view === "studio") void studio?.activate().catch((error) => { status.textContent = error.message; });
  else studio?.deactivate();
  if (view === "session-harnesses") {
    status.textContent = "";
    void loadSessionHarnesses(freshProfile ? "" : undefined);
  } else if (!window.engineeringDesktop) status.textContent = "데스크톱 앱에서 Engineering을 열어 주세요.";
  for (const name of views) find(name).hidden = (view === "loop" ? "design" : view) !== name;
  for (const name of [...views, "loop"]) find(name + "-nav").setAttribute("aria-pressed", String(view === name));
}
const showDefinitions = (type, fresh = false, initialScope) => report(async () => {
  if ((kind.value !== type || fresh) && !editor.mayReplace()) return;
  const changed = kind.value !== type;
  kind.value = type;
  if (initialScope) setScope(initialScope);
  showView(type === "loop" ? "loop" : "design");
  if (!window.engineeringDesktop) return;
  if (changed || fresh) await refreshEditor("");
  else if (scopedDefinitionsStale && editor.mayReplace()) await refreshEditor();
});
for (const view of views.filter((name) => name !== "design")) find(view + "-nav").onclick = () => showView(view);
find("design-nav").onclick = showDefinitions("harness");
find("loop-nav").onclick = showDefinitions("loop");
find("definition-model-open").onclick = showDefinitions("model");
find("definition-harness-open").onclick = showDefinitions("harness");
find("definition-new").onclick = (event) => showDefinitions(kind.value, true)(event);
find("definition-loop-harness").onclick = showDefinitions("harness", true);
find("setup-new-profile").onclick = () => showView("session-harnesses", true);
find("setup-new-harness").onclick = showDefinitions("harness", true, "personal");
find("setup-new-loop").onclick = showDefinitions("loop", true, "personal");
updateStarter();
starter.onclick = report(async () => {
  creatingDefaults = true;
  updateStarter("기본 프로필, 하네스, 루프를 만드는 중입니다.");
  let result;
  try {
    await addWorkflowDefaults();
    result = "개인 기본 구성이 준비됐습니다. 프로필, 하네스, 루프에서 확인할 수 있습니다.";
  } finally {
    creatingDefaults = false;
    updateStarter(result);
  }
});
studio = bindStudio({
  find, request, report,
  currentProject: () => projects.find(({ id }) => id === project.value),
  // 노드 캔버스에서 저장하면 폼 화면·Workflow 화면이 가진 목록도 새로 읽게 한다.
  async changed() {
    scopedDefinitionsStale = true;
    const selectedId = project.value;
    if (!selectedId || !window.engineeringDesktop) return;
    const records = await request("definitions", { project: selectedId });
    if (selectedId === project.value) showAvailable(records);
    await workflow?.reloadList?.();
  },
  profilesChanged(list) {
    find("session-harness-editor").dispatchEvent(new CustomEvent("profileschange", { bubbles: true, detail: list }));
  },
  openWorkflow(id) {
    showView("workflow");
    const list = find("workflow-list");
    if ([...list.options].some((option) => option.value === id)) {
      list.value = id;
      list.dispatchEvent(new Event("change"));
    }
  },
  openHarness: (id, version) => report(() => editor.open(id, version))(),
});
const params = new URLSearchParams(location.search);
const target = params.get("view") ?? "studio";
if (target === "loop") kind.value = "loop";
if (views.includes(target) || target === "loop") showView(target);

if (window.engineeringDesktop) {
  workflow = bindWorkflow({ find, request, report, definitions: () => definitions, editHarness: editor.open, addWorkflowDefaults });
  sdlc = bindSdlc({ find, request, report, showRun: async (id) => {
    find("workflow-nav").click();
    await workflow.showRun(id);
  } });
  const runtimeStatus = bindRuntimeControls({ find, request, report, status, formValues });
  report(async () => {
    setScope(params.get("project") && ["design", "loop"].includes(target) ? "project" : "personal");
    await Promise.all([refreshProjects(params.get("project") || undefined, true), runtimeStatus()]);
    if (target === "workflow" && params.get("run") && project.value) await workflow.showRun(params.get("run"));
    if (target === "design" && params.get("harness") && project.value) {
      await editor.open(params.get("harness"), Number(params.get("version")));
    }
  })();
  setInterval(() => {
    if (!find("execution").hidden && project.value) void refreshRuns().catch(() => {});
    void runtimeStatus().catch(() => {});
  }, 1800);
} else if (target !== "session-harnesses") status.textContent = "데스크톱 앱에서 Engineering을 열어 주세요.";
