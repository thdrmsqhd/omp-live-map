import { bindDefinitionEditor } from "./engineering-definitions.js";
import { bindRuntimeControls } from "./engineering-runtime.js";
import { bindWorkflow } from "./workflow-editor.js";
import { bindSdlc } from "./sdlc.js";

const find = (id) => document.getElementById(id);
const status = find("status");
const project = find("project");
const loop = find("loop");
const runs = find("runs");
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

const editor = bindDefinitionEditor({
  find, request, report, options, definitions: () => definitions, refreshDefinitions,
});

async function refreshProjects(chosen, editSelected = false) {
  projects = await request("projects");
  options(project, projects.map((entry) => ({ id: entry.id, name: entry.name + (entry.archived ? " (보관됨)" : "") })), "프로젝트 선택", chosen);
  if (editSelected) {
    const selected = projects.find((entry) => entry.id === project.value);
    const form = find("project-form");
    form.elements.name.value = selected?.name ?? "";
    form.elements.root.value = selected?.root ?? "";
    form.elements.branch.value = selected?.branch ?? "";
    form.dataset.project = selected?.id ?? "";
  }
  await refreshDefinitions();
}

async function refreshDefinitions(chosen) {
  const selected = projects.find((entry) => entry.id === project.value);
  find("archive").disabled = !selected || selected.archived;
  definitions = selected ? await request("definitions", { project: selected.id }) : [];
  editor.select(chosen);
  options(loop, definitions.filter((entry) => entry.kind === "loop"), "Loop 선택");
  await workflow?.selectProject(selected?.id ?? "");
  await sdlc?.selectProject(selected?.id ?? "");
  await refreshRuns();
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
    line.append(`시도 ${attempt.number} · ${attempt.status}`, output);
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
const views = ["design", "workflow", "sdlc", "execution"];
for (const view of views) {
  find(view + "-nav").addEventListener("click", () => {
    for (const name of views) {
      find(name).hidden = view !== name;
      find(name + "-nav").setAttribute("aria-pressed", String(view === name));
    }
  });
}
if (window.engineeringDesktop) {
  workflow = bindWorkflow({ find, request, report, definitions: () => definitions, editHarness: editor.open });
  sdlc = bindSdlc({ find, request, report, showRun: async (id) => {
    find("workflow-nav").click();
    await workflow.showRun(id);
  } });
  const runtimeStatus = bindRuntimeControls({ find, request, report, status, formValues });
  report(async () => {
    const params = new URLSearchParams(location.search);
    await Promise.all([refreshProjects(params.get("project") || undefined, true), runtimeStatus()]);
    const target = params.get("view");
    if (views.includes(target)) find(target + "-nav").click();
    if (target === "workflow" && params.get("run") && project.value) await workflow.showRun(params.get("run"));
  })();
  setInterval(() => {
    if (!find("execution").hidden && project.value) void refreshRuns().catch(() => {});
    void runtimeStatus().catch(() => {});
  }, 1800);
} else status.textContent = "데스크톱 앱에서 Engineering을 열어 주세요.";
