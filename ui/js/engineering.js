// Engineering 설정 페이지: 프로젝트·팀·실행 환경 설정, 개발 Task, Loop 실행.
// 정의·Workflow 편집(노드 캔버스)과 Workflow 실행·승인·결과·배포는 모두 관제 화면(/)에서 한다(설계 모드와 Live Map).
import { harnessProvenance } from "./harness-provenance.js";
import { bindRuntimeControls } from "./engineering-runtime.js";
import { bindSdlc } from "./sdlc.js";

const find = (id) => document.getElementById(id);
const status = find("status");
const project = find("project");
const loop = find("loop");
const runs = find("runs");
let projects = [];
let projectRequest = 0;
let currentRunRequest = null;
let sdlc;

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

function formValues(event) {
  return Object.fromEntries(new FormData(event.currentTarget));
}

// 관제 화면으로 넘긴다. 실행을 열거나(run), 새 실행 대화상자(launch), 설계 모드(mode=design, workflow)를 연다.
function openLiveMap(params) {
  location.href = "/?" + new URLSearchParams(params);
}

async function showAvailable(projectId) {
  const records = projectId ? await request("definitions", { project: projectId }) : [];
  if (projectId !== project.value) return;
  options(loop, records.filter((entry) => entry.kind === "loop")
    .map((entry) => ({ id: entry.id, name: engineeringDefinitionLabel(entry) })), "루프 선택");
}

async function refreshProjects(chosen, editSelected = false) {
  const revision = ++projectRequest;
  const [records, teams] = await Promise.all([request("projects"), request("teams")]);
  if (revision !== projectRequest) return;
  projects = records;
  options(project, projects.map((entry) => ({ id: entry.id, name: entry.name + (entry.archived ? " (보관됨)" : "") })), "프로젝트 선택", chosen);
  const selected = projects.find((entry) => entry.id === project.value);
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
  await Promise.all([
    showAvailable(selected?.id ?? ""),
    sdlc?.selectProject(selected?.id ?? ""),
    refreshRuns(),
  ]);
}

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

find("project-form").addEventListener("input", (event) => {
  if (event.target.name === "root") event.currentTarget.dataset.project = "";
});
find("project-form").addEventListener("submit", report(async (event) => {
  const saved = await request("projects", {}, { ...formValues(event), id: event.currentTarget.dataset.project || undefined });
  await refreshProjects(saved.id, true);
}));
project.addEventListener("change", report(async () => refreshProjects(project.value, true)));
find("archive").addEventListener("click", report(async () => {
  await request("projects/archive", {}, { id: project.value });
  await refreshProjects(project.value, true);
}));
find("team-form").addEventListener("submit", report(async (event) => {
  const form = event.currentTarget;
  const team = await request("teams", {}, formValues(event));
  find("known-teams").replaceChildren(...(await request("teams")).map((name) => new Option(name, name)));
  form.reset();
  find("team-settings").open = false;
  status.textContent = `팀 '${team}'을(를) 등록했습니다. 프로젝트 설정의 팀 이름에 넣으면 그 프로젝트에서 팀 범위 정의를 씁니다.`;
}));
find("run-form").addEventListener("submit", report(async (event) => {
  const values = { ...formValues(event), project: project.value };
  const input = JSON.stringify(values);
  if (currentRunRequest?.input !== input) currentRunRequest = { input, key: crypto.randomUUID() };
  // Loop 하나를 Start → Loop → End Workflow 로 감싸 실행한다. 진행·승인·재시도는 관제 맵에서 본다.
  const run = await request("workflows/launch-loop", {}, { ...values, key: currentRunRequest.key });
  currentRunRequest = null;
  openLiveMap({ run: run.id });
}));
runs.addEventListener("change", report(async () => refreshRuns()));
find("actions").addEventListener("click", report(async (event) => {
  if (event.target.dataset.operation && runs.value) {
    await request("runs/action", {}, { id: runs.value, operation: event.target.dataset.operation });
    await refreshRuns();
  }
}));

const views = ["sdlc", "execution"];
function showView(view) {
  for (const name of views) {
    find(name).hidden = view !== name;
    find(name + "-nav").setAttribute("aria-pressed", String(view === name));
  }
}
for (const view of views) find(view + "-nav").onclick = () => showView(view);

// 예전 주소: 실행(run)은 관제로, 노드 캔버스·폼 화면(view=studio·design·loop·session-harnesses·setup·workflow)은 관제의 설계 모드로 보낸다.
const params = new URLSearchParams(location.search);
const requested = params.get("view") ?? "sdlc";
if (params.get("run")) openLiveMap({ run: params.get("run") });
else if (!views.includes(requested) || params.get("workflow")) {
  openLiveMap({ mode: "design", ...(params.get("project") ? { project: params.get("project") } : {}), ...(params.get("workflow") ? { workflow: params.get("workflow") } : {}) });
}
showView(views.includes(requested) ? requested : "sdlc");

if (window.engineeringDesktop) {
  sdlc = bindSdlc({ find, request, report, showRun: async (id) => openLiveMap({ run: id }) });
  const runtimeStatus = bindRuntimeControls({ find, request, report, status, formValues });
  report(async () => {
    await Promise.all([refreshProjects(params.get("project") || undefined, true), runtimeStatus()]);
  })();
  setInterval(() => {
    if (!find("execution").hidden && project.value) void refreshRuns().catch(() => {});
    void runtimeStatus().catch(() => {});
  }, 1800);
} else status.textContent = "데스크톱 앱에서 Engineering을 열어 주세요.";
