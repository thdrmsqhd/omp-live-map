// 설계 모드의 첫 실행 안내: 실행 환경 → 프로젝트 등록 → 기본 구성 → 기본 Workflow → 첫 Workflow 열기.
// 모든 단계는 기존 Engineering API 만 쓴다. 프로젝트 등록은 메인 프로세스의 폴더 선택 결과로만 허용된다(desktop/main.cjs).
const DISMISS_KEY = "omp-first-run-dismissed";

export function bindFirstRun({ find, request, currentProject, reloadProjects, openWorkflow }) {
  const panel = find("first-run");
  const list = find("first-run-steps");
  const note = find("first-run-status");
  let busy = false;

  const say = (text) => { note.textContent = text; };
  const button = (label, action) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.onclick = async () => {
      if (busy) return;
      busy = true;
      element.disabled = true;
      say("");
      try { await action(); } catch (error) { say(error.message); }
      finally { busy = false; await refresh(); }
    };
    return element;
  };
  const link = (label, href) => Object.assign(document.createElement("a"), { textContent: label, href });

  async function state() {
    const [runtime, projects, personal] = await Promise.all([
      request("runtime").catch(() => null),
      request("projects"),
      request("definitions", { scope: "personal" }).catch(() => []),
    ]);
    const project = currentProject();
    const [workflows, runs] = project ? await Promise.all([
      request("workflows", { project: project.id }).catch(() => []),
      request("workflow-runs", { project: project.id }).catch(() => []),
    ]) : [[], []];
    return { runtime, projects, personal, project, runs, workflows: workflows.filter(({ generated }) => !generated) };
  }

  function step(done, title, detail, ...actions) {
    const item = document.createElement("li");
    item.dataset.done = done ? "1" : "";
    const head = document.createElement("strong");
    head.textContent = (done ? "완료 · " : "") + title;
    const text = document.createElement("span");
    text.textContent = detail;
    item.append(head, text);
    if (!done && actions.length) {
      const row = document.createElement("div");
      row.className = "first-run-actions";
      row.append(...actions);
      item.append(row);
    }
    return item;
  }

  async function refresh() {
    if (!panel) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") { panel.hidden = true; return; }
    let current;
    try { current = await state(); } catch (error) { say(error.message); return; }
    const { runtime, projects, personal, project, workflows, runs } = current;
    const ready = runtime?.status === "ready";
    const hasDefaults = personal.some(({ kind }) => kind === "harness") && personal.some(({ kind }) => kind === "loop");
    const bugfix = workflows.find(({ name }) => name.includes("버그 수정")) ?? workflows[0];
    const steps = [
      step(ready, "실행 환경", ready ? "Docker 런타임과 인증이 준비되었습니다." : (runtime?.detail || "Docker Desktop과 Claude Code 로그인 또는 API 키가 필요합니다."),
        link("설정에서 준비", "/engineering.html")),
      step(projects.length > 0, "프로젝트 등록", projects.length ? `${projects.length}개 등록됨` : "작업할 Git 저장소의 루트 폴더를 고릅니다.",
        ...(window.engineeringDesktop?.pickFolder ? [button("폴더 선택", async () => {
          const picked = await window.engineeringDesktop.pickFolder();
          if (!picked.ok) throw new Error(picked.error || "폴더를 고르지 않았습니다.");
          const saved = await request("projects/register-picked", {}, { root: picked.value });
          await reloadProjects(saved.id);
          say(`${saved.name} 프로젝트를 등록했습니다.`);
        })] : [])),
      step(hasDefaults, "기본 구성", hasDefaults ? "모델·하네스·루프·프로필이 있습니다." : "기본 모델·하네스·루프·프로필을 개인 범위에 추가합니다.",
        button("기본 구성 추가", async () => {
          await request("workflows/presets/defaults", {}, { scope: "personal" });
          await reloadProjects(project?.id);
        })),
      step(workflows.length > 0, "기본 Workflow", workflows.length ? `${workflows.length}개 있음` : "버그 수정·코드 리뷰 등 8종을 이 프로젝트에 만듭니다.",
        ...(project ? [button("기본 Workflow 8종 추가", async () => {
          await request("workflows/presets/all", {}, { project: project.id });
          await reloadProjects(project.id);
        })] : [])),
    ];
    const complete = ready && projects.length > 0 && hasDefaults && workflows.length > 0;
    if (bugfix && projects.length > 0 && hasDefaults) {
      steps.push(step(false, "첫 실행", `‘${bugfix.name}’을 열고 ‘실행 시작’을 누르면 작업 목표와 완료 조건만 입력하면 됩니다.`,
        button("열기", async () => { await openWorkflow(bugfix.id); })));
    }
    list.replaceChildren(...steps);
    // 준비가 끝나고 실행을 한 번이라도 했으면 더 안내하지 않는다.
    panel.hidden = complete && runs.length > 0;
    panel.dataset.complete = complete ? "1" : "";
  }

  find("first-run-dismiss")?.addEventListener("click", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    panel.hidden = true;
  });
  return { refresh };
}
