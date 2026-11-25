import { bindSessionHarnesses } from "./session-harnesses.js";
import { harnessProvenance } from "./harness-provenance.js";
import { bindDefinitionEditor } from "./engineering-definitions.js";
import { bindRuntimeControls } from "./engineering-runtime.js";
import { bindWorkflow } from "./workflow-editor.js";
import { bindSdlc } from "./sdlc.js";

const find = (id) => document.getElementById(id);
const status = find("status");
const project = find("project");
const loop = find("loop");
const runs = find("runs");
const scopeButtons = [...document.querySelectorAll("[data-definition-scope]")];
const teamPicker = find("definition-team");
let scope = "personal";
let scopedDefinitions = [];
let scopeRequest = 0;
let projectRequest = 0;
let definitions = [];
let projects = [];
let currentRunRequest = null;
let workflow;
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
  find("definition-team-field").hidden = scope !== "team";
  const kind = find("kind");
  kind.querySelector('[value="loop"]').disabled = scope !== "project";
  if (scope !== "project" && kind.value === "loop") kind.value = "harness";
}

const editor = bindDefinitionEditor({
  find, request, report, options, definitions: () => scopedDefinitions, refreshDefinitions: refreshEditor,
  owner, canPreview,
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
  const content = find("definition-content");
  content.disabled = true;
  content.hidden = !ready;
  find("definition-owner").textContent = ready ? "저장 위치 · " + label + (archived ? " (보관됨)" : "") :
    scope === "team" ? "저장할 팀을 선택하세요. 팀이 없으면 프로젝트에 팀 이름을 등록하세요." :
      "위에서 작업 프로젝트를 선택하세요.";
  const selectedId = project.value;
  const [records, available] = await Promise.all([
    ready ? request("definitions", { scope, ...(projectId ? { project: projectId } : {}), ...(team ? { team } : {}) }) : [],
    refreshAvailable && selectedId ? request("definitions", { project: selectedId }) : null,
  ]);
  if (available && selectedId === project.value) {
    definitions = available;
    options(loop, definitions.filter((entry) => entry.kind === "loop"), "Loop 선택");
    workflow?.refreshProfiles();
  }
  if (revision !== scopeRequest) return;
  scopedDefinitions = records;
  content.disabled = !ready;
  editor.select(chosen);
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
  definitions = available;
  options(loop, definitions.filter((entry) => entry.kind === "loop"), "Loop 선택");
  workflow?.refreshProfiles();
  await Promise.all([
    refreshEditor(),
    workflow?.selectProject(selected?.id ?? ""),
    sdlc?.selectProject(selected?.id ?? ""),
    refreshRuns(),
  ]);
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
project.addEventListener("change", report(async () => { if (editor.mayReplace(project)) await refreshProjects(project.value, true); }));
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
const views = ["design", "workflow", "session-harnesses", "sdlc", "execution"];
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
for (const view of views) {
  find(view + "-nav").addEventListener("click", () => {
    find("engineering-context").hidden = view === "session-harnesses";
    if (view === "session-harnesses") {
      status.textContent = "";
      void loadSessionHarnesses();
    } else if (!window.engineeringDesktop) status.textContent = "데스크톱 앱에서 Engineering을 열어 주세요.";
    for (const name of views) {
      find(name).hidden = view !== name;
      find(name + "-nav").setAttribute("aria-pressed", String(view === name));
    }
  });
}
const params = new URLSearchParams(location.search);
const target = params.get("view");
if (views.includes(target)) find(target + "-nav").click();

if (window.engineeringDesktop) {
  workflow = bindWorkflow({ find, request, report, definitions: () => definitions, editHarness: editor.open });
  sdlc = bindSdlc({ find, request, report, showRun: async (id) => {
    find("workflow-nav").click();
    await workflow.showRun(id);
  } });
  const runtimeStatus = bindRuntimeControls({ find, request, report, status, formValues });
  report(async () => {
    setScope(params.get("project") ? "project" : "personal");
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
