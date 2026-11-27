// 관제 화면의 'Task' 탭: 작업 프로젝트 · 요약 한 줄(실행·예산) · 개발 Task 칸반 · 승인 대기함. 폼은 없다.
// 프로젝트는 따로 등록하지 않는다. 관제가 이미 묶어 둔 세션 폴더(프로젝트 탭과 같은 묶음)에서 고르면 그 자리에서
// 프로젝트가 되고(projects/ensure: 이름 = 폴더 이름, 브랜치 = 지금 브랜치), 새 폴더는 '＋ 새 폴더…'로 고른다
// (데스크톱: 폴더 대화상자, 웹: 경로 한 칸). 이름 바꾸기·보관은 프로젝트 탭 카드의 ⋯ 메뉴에서 한다.
// 주소: /?mode=tasks[&project=<프로젝트>]
import { bindRuntimeDot } from "./engineering-runtime.js";
import { bindSdlc } from "./sdlc.js";

const find = (id) => document.getElementById(id);
const status = find("eng-status"), picker = find("eng-project"), pathInput = find("eng-folder-path");
const PROJECT_KEY = "omp-tasks-project";
let projects = [], entering = null, lastValue = "";

async function request(endpoint, params, payload) {
  const result = await window.engineeringApi.request(endpoint, params ?? {}, payload);
  if (!result.ok) throw new Error(result.error || "요청에 실패했습니다.");
  return result.value;
}
function report(work) {
  return async (event) => {
    event?.preventDefault?.();
    status.textContent = "";
    try { await work(event); } catch (error) { status.textContent = error.message; }
  };
}

const folderName = (folder) => String(folder).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;
// 프로젝트 탭과 같은 묶음(model/monitor.js monitorGroupSessions): 등록 프로젝트 밖의 세션 폴더만 남긴다.
function sessionFolders() {
  const groups = typeof monitorGroupSessions === "function" ? monitorGroupSessions(DATA.sessions || [], projects) : [];
  return groups.filter((group) => !group.project && /^([a-zA-Z]:[\\/]|\/)/.test(group.folder || "")).map((group) => group.folder);
}
function fill(chosen) {
  const active = projects.filter(({ archived }) => !archived), folders = sessionFolders();
  const group = (label, items) => {
    const element = document.createElement("optgroup");
    element.label = label;
    element.append(...items);
    return element;
  };
  picker.replaceChildren();
  if (!active.length) picker.append(new Option("작업 폴더를 고르세요", ""));
  if (active.length) picker.append(group("프로젝트", active.map(({ id, name }) => new Option(name, id))));
  if (folders.length) picker.append(group("세션 폴더 · 고르면 프로젝트가 됩니다", folders.map((folder) => new Option(folderName(folder) + " · " + folder, "folder:" + folder))));
  picker.append(new Option(window.engineeringDesktop?.pickFolder ? "＋ 새 폴더…" : "＋ 새 폴더 (경로 붙여 넣기)…", "pick:"));
  const values = [...picker.options].map(({ value }) => value);
  picker.value = values.includes(chosen) ? chosen : active[0]?.id ?? "";
  lastValue = picker.value;
}
async function refreshProjects(chosen) {
  projects = await request("projects");
  fill(chosen ?? picker.value);
  writeJSON(PROJECT_KEY, picker.value);
  await sdlc.selectProject(projects.some(({ id }) => id === picker.value) ? picker.value : "");
}
// 폴더를 프로젝트로 만든다(이미 있으면 그 프로젝트). 그 프로젝트를 골라 둔다.
async function ensure(root) {
  const saved = await request("projects/ensure", {}, { root });
  await refreshProjects(saved.id);
  status.textContent = `'${saved.name}' 폴더를 프로젝트로 씁니다.`;
  return saved.id;
}
// 쓰기 전에 부른다: 지금 고른 것이 아직 프로젝트가 아닌 세션 폴더면 여기서 프로젝트로 만든다.
async function need() {
  if (projects.some(({ id }) => id === picker.value)) return picker.value;
  if (picker.value.startsWith("folder:")) return ensure(picker.value.slice(7));
  throw new Error("작업 폴더를 먼저 고르세요. 위 목록의 세션 폴더나 '＋ 새 폴더'를 쓰면 됩니다.");
}
function askPath() {
  pathInput.hidden = false;
  pathInput.value = "";
  pathInput.focus();
}
picker.addEventListener("change", report(async () => {
  const value = picker.value;
  if (value === "pick:") {
    picker.value = lastValue;
    if (!window.engineeringDesktop?.pickFolder) return askPath();
    const picked = await window.engineeringApi.pickFolder();
    if (picked.ok) await ensure(picked.value);
    return;
  }
  pathInput.hidden = true;
  if (value.startsWith("folder:")) { await ensure(value.slice(7)); return; }
  lastValue = value;
  writeJSON(PROJECT_KEY, value);
  await sdlc.selectProject(value);
}));
pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); pathInput.hidden = true; picker.focus(); return; }
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  const root = pathInput.value.trim().replace(/^"(.*)"$/, "$1");
  if (!root) return;
  void report(async () => { await ensure(root); pathInput.hidden = true; })();
});

// 같은 화면의 맵 탭에서 실행을 연다(진행·승인·재시도·결과).
async function showRun(id) {
  setMapMode("map");
  if (typeof openMapWorkflow === "function") await openMapWorkflow(id);
}

const sdlc = bindSdlc({ find, request, report, showRun, need });
bindRuntimeDot({ request });

// 탭을 처음 열 때 데이터를 불러온다. 끝나면 #engineering[data-ready="1"] 로 알린다(검증 스크립트가 기다린다).
function enter(chosen) {
  if (!entering) entering = report(async () => refreshProjects(chosen || readJSON(PROJECT_KEY, "") || undefined))();
  else if (chosen && chosen !== picker.value) entering = entering.then(report(async () => refreshProjects(chosen)));
  find("engineering").dataset.ready = "";
  const current = entering;
  void current.finally(() => { if (current === entering) find("engineering").dataset.ready = "1"; });
  return entering;
}
document.addEventListener("omp-mode", (event) => { if (event.detail === "tasks") void enter(); });

// 다른 탭에서 부른다. open: Task 탭 열기. quick: Backlog ＋ 줄을 그 Workflow 로 연다(run 이면 Enter = 만들고 실행).
window.ompTasks = {
  async open({ project: chosen } = {}) {
    setMapMode("tasks");
    await enter(chosen);
  },
  async quick({ project: chosen, folder, workflow, run } = {}) {
    setMapMode("tasks");
    await enter(chosen || undefined);
    // 세션 카드 메뉴 '이 폴더에서 Task 만들기': 그 폴더를 프로젝트로 쓰고(처음이면 여기서 생김) ＋ 줄을 연다.
    if (folder) await report(async () => ensure(folder))();
    sdlc.openQuick({ workflow, run });
  },
};
const newRun = find("workflow-new-run");
if (newRun) {
  newRun.hidden = false;
  newRun.title = "Task 탭 Backlog에 한 줄로 만들고 바로 실행";
  newRun.onclick = () => void window.ompTasks.quick({ project: picker.value && !picker.value.includes(":") ? picker.value : undefined, run: true });
}

const fromAddress = (search) => ({ project: new URLSearchParams(search).get("project") || undefined });
// 같은 화면 안의 Task 탭 링크(/?mode=tasks…)는 새로 고치지 않고 탭을 연다. 대화상자 안 링크면 대화상자를 닫는다.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href^="/?mode=tasks"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  link.closest("dialog")?.close();
  void window.ompTasks.open(fromAddress(new URL(link.href).search));
});

if (new URLSearchParams(location.search).get("mode") === "tasks") {
  const wanted = fromAddress(location.search);
  history.replaceState(null, "", location.pathname);
  void window.ompTasks.open(wanted);
} else if (mapMode === "tasks") void enter();
