// 관제 화면의 '설계' 모드: 노드 캔버스(모델 → 하네스 → 루프 → Workflow)를 관제와 같은 창에서 편집한다. 화면은 캔버스뿐이다.
// 관제 ↔ 설계를 오가도 편집 중인 캔버스와 프로젝트 선택은 그대로 남는다.
//  - 관제 실행 상세의 '설계에서 편집' → 이 모드로 와서 그 Workflow 를 연다(window.ompDesign.open).
//  - 캔버스의 '실행 시작' → Task 탭의 Backlog ＋ 줄을 이 Workflow 로 연다(Enter = 카드 만들고 실행).
// 주소: /?mode=design&project=<프로젝트>&workflow=<Workflow>
import { bindStudio } from "./studio.js";

const find = (id) => document.getElementById(id);
const PROJECT_KEY = "omp-design-project";

{
  const status = find("design-status");
  const picker = find("design-project");
  let projects = [], loaded = null, active = false;

  const request = async (endpoint, params, payload) => {
    const result = await window.engineeringApi.request(endpoint, params ?? {}, payload);
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
    // 실행은 Task 카드로 한다: Task 탭 Backlog 의 ＋ 줄을 이 프로젝트·Workflow 로 연다.
    openWorkflow(id) {
      void window.ompTasks?.quick({ project: picker.value, workflow: id, run: true });
    },
  });

  async function loadProjects(chosen) {
    projects = await request("projects");
    const value = chosen ?? picker.value ?? readJSON(PROJECT_KEY, "");
    picker.replaceChildren(new Option("아직 없음 · Task 탭에서 폴더를 고르면 생깁니다", ""), ...projects.map(({ id, name, archived }) => new Option(name + (archived ? " (보관됨)" : ""), id)));
    picker.value = projects.some(({ id }) => id === value) ? value : projects.find(({ archived }) => !archived)?.id ?? "";
    writeJSON(PROJECT_KEY, picker.value);
    await studio.selectProject(picker.value, projects.find(({ id }) => id === picker.value));
    loaded = picker.value;
    if (active) window.OMPIndependentEvaluation?.show(picker.value); window.UnifiedProjectContext?.show(loaded);
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
        if (active) window.UnifiedProjectContext?.show(picker.value);
      } catch (error) { status.textContent = error.message; }
    })();
    return entering;
  }
  function leave() {
    if (!active) return;
    active = false;
    entering = null;
    studio.deactivate();
    window.UnifiedProjectContext?.hide();
  }
  picker.addEventListener("change", report(async () => {
    if (!studio.mayReplace()) { picker.value = studio.projectId(); return; }
    writeJSON(PROJECT_KEY, picker.value);
    await studio.selectProject(picker.value, projects.find(({ id }) => id === picker.value));
    loaded = picker.value;
    if (active) window.UnifiedProjectContext?.show(loaded);
    window.UnifiedWorkflow?.paint();
  }));
  document.addEventListener("omp-mode", (event) => { if (event.detail === "design") void enter(); else leave(); });
  addEventListener("beforeunload", (event) => { if (studio.dirty()) event.preventDefault(); });

  // 관제에서 부른다: 그 프로젝트의 Workflow 를 설계 모드에서 연다.
  window.ompDesign = {
    matches(run) {
      const current = studio.currentWorkflow?.();
      return !!current && picker.value === run.project && current.id === run.workflow && Number(current.version) === Number(run.version);
    },
    focusStep(id) { return studio.focusStep?.(id); },
    async open({ project, workflow } = {}) {
      setMapMode("design");
      await enter();
      if (project && project !== picker.value) {
        if (!studio.mayReplace()) return;
        await loadProjects(project);
      }
      if (workflow && studio.currentWorkflow?.()?.id !== workflow && !(await studio.showWorkflow(workflow))) status.textContent = "이 실행은 편집 가능한 Workflow와 연결되지 않습니다. 실행 스냅샷에서 관제할 수 있습니다.";
      window.UnifiedWorkflow?.paint();
    },
  };

  // 주소로 연 설계 화면이 프로젝트·Workflow 를 다 불러오면 #design[data-ready="1"] 로 알린다.
  // 그 전에는 캔버스가 다시 그려지며 열린 메뉴를 닫거나 노드 위치를 되돌릴 수 있다(검증 스크립트가 이 표시를 기다린다).
  const settle = (work) => { find("design").dataset.ready = ""; void work.finally(() => { find("design").dataset.ready = "1"; }); };
  const address = new URLSearchParams(location.search);
  if (address.get("mode") === "design" || address.get("workflow")) {
    history.replaceState(null, "", location.pathname);
    settle(window.ompDesign.open({ project: address.get("project") || undefined, workflow: address.get("workflow") || undefined }));
  } else if (address.get("mode") === "map") {
    history.replaceState(null, "", location.pathname);
    setMapMode("map");
  } else if (mapMode === "design") settle(enter());
}
