// 관제 화면의 '설계' 모드: 노드 캔버스(모델·하네스·루프·프로필·Workflow)를 관제와 같은 창에서 편집한다.
// 관제 ↔ 설계를 오가도 편집 중인 캔버스와 프로젝트 선택은 그대로 남는다.
//  - 관제 실행 상세의 '설계에서 편집' → 이 모드로 와서 그 Workflow 를 연다(window.ompDesign.open).
//  - 캔버스의 '관제에서 실행' → 관제로 돌아가 새 실행 대화상자를 연다.
// 주소: /?mode=design&project=<프로젝트>&workflow=<Workflow>
import { bindStudio } from "./studio.js";

const find = (id) => document.getElementById(id);
const PROJECT_KEY = "omp-design-project";

if (window.engineeringDesktop) {
  const status = find("design-status");
  const picker = find("design-project");
  let projects = [], loaded = null, active = false;

  const request = async (endpoint, params, payload) => {
    const result = await window.engineeringDesktop.request(endpoint, params ?? {}, payload);
    if (!result.ok) throw new Error(result.error || "요청에 실패했습니다.");
    return result.value;
  };
  const report = (work) => async (event) => {
    event?.preventDefault();
    status.textContent = "";
    try { await work(event); } catch (error) { status.textContent = error.message; }
  };
  const studio = bindStudio({
    find, request, report,
    currentProject: () => projects.find(({ id }) => id === picker.value),
    openWorkflow(id) {
      setMapMode("map");
      if (typeof openMapWorkflowLaunch === "function") void openMapWorkflowLaunch(picker.value, id);
    },
  });

  async function loadProjects(chosen) {
    projects = await request("projects");
    const value = chosen ?? picker.value ?? readJSON(PROJECT_KEY, "");
    picker.replaceChildren(new Option("프로젝트 선택", ""), ...projects.map(({ id, name, archived }) => new Option(name + (archived ? " (보관됨)" : ""), id)));
    picker.value = projects.some(({ id }) => id === value) ? value : projects.find(({ archived }) => !archived)?.id ?? "";
    writeJSON(PROJECT_KEY, picker.value);
    await studio.selectProject(picker.value, projects.find(({ id }) => id === picker.value));
    loaded = picker.value;
  }
  // 모드 전환 이벤트와 '설계에서 편집'이 동시에 부를 수 있으므로 진행 중인 준비를 함께 기다린다
  // (그렇지 않으면 캔버스 새로 고침이 방금 연 Workflow 선택을 되돌린다).
  let entering = null;
  function enter() {
    if (active) return entering ?? Promise.resolve();
    active = true;
    entering = (async () => {
      try {
        if (loaded === null) await loadProjects(readJSON(PROJECT_KEY, ""));
        await studio.activate();
      } catch (error) { status.textContent = error.message; }
    })();
    return entering;
  }
  function leave() {
    if (!active) return;
    active = false;
    entering = null;
    studio.deactivate();
  }
  picker.addEventListener("change", report(async () => {
    if (!studio.mayReplace()) { picker.value = studio.projectId(); return; }
    writeJSON(PROJECT_KEY, picker.value);
    await studio.selectProject(picker.value, projects.find(({ id }) => id === picker.value));
    loaded = picker.value;
  }));
  document.addEventListener("omp-mode", (event) => { if (event.detail === "design") void enter(); else leave(); });
  addEventListener("beforeunload", (event) => { if (studio.dirty()) event.preventDefault(); });

  // 관제에서 부른다: 그 프로젝트의 Workflow 를 설계 모드에서 연다.
  window.ompDesign = {
    async open({ project, workflow } = {}) {
      setMapMode("design");
      await enter();
      if (project && project !== picker.value) {
        if (!studio.mayReplace()) return;
        await loadProjects(project);
      }
      if (workflow && !(await studio.showWorkflow(workflow))) status.textContent = "그 Workflow 를 이 프로젝트에서 찾지 못했습니다.";
    },
  };

  document.querySelector('#viewModes [data-mode="design"]').hidden = false;
  const address = new URLSearchParams(location.search);
  if (address.get("mode") === "design" || address.get("workflow")) {
    history.replaceState(null, "", location.pathname);
    void window.ompDesign.open({ project: address.get("project") || undefined, workflow: address.get("workflow") || undefined });
  } else if (address.get("mode") === "map") {
    history.replaceState(null, "", location.pathname);
    setMapMode("map");
  } else if (mapMode === "design") void enter();
}
