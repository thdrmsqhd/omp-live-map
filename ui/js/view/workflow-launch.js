/* Workflow 시작 폼. 실제 Workflows API를 통해 저장된 실행기를 사용한다. */
async function mapWorkflowRequest(endpoint, params, payload) {
  const result = await window.engineeringDesktop.request(endpoint, params ?? {}, payload);
  if (!result.ok) throw new Error(result.error || "Workflow 요청에 실패했습니다.");
  return result.value;
}

// 고른 하네스는 역할과 모델, Loop 는 반복할 하네스·최대 시도·검증 명령을 한 줄로 요약한다.
function workflowRoleSummary(id, definitions) {
  const item = id ? definitions.find((entry) => entry.id === id) : null;
  if (!item) return "";
  const nameOf = (target) => definitions.find((entry) => entry.id === target)?.name;
  const payload = item.payload ?? {};
  if (item.kind === "harness") return `역할 ${payload.role} · ${nameOf(payload.model) ? "모델 " + nameOf(payload.model) : "모델 연결 안 됨"}`;
  if (item.kind !== "loop") return "";
  const check = payload.checks?.[0];
  const verify = check ? "검증 " + [check.command, ...(check.args ?? [])].join(" ") : "검증 명령 없음";
  return `${nameOf(payload.harness) ? "하네스 " + nameOf(payload.harness) : "하네스 연결 안 됨"} · 최대 ${payload.attempts}회 · ${verify}`;
}

// 저장된 Workflow 의 하네스·Loop 단계가 무엇으로 도는지 단계마다 한 줄로 적는다.
function workflowStepSummaries(payload, definitions) {
  const edges = payload?.edges ?? [];
  return (payload?.nodes ?? []).filter((node) => node.type === "agent" || node.type === "loop").map((node) => {
    const item = node.definition ? definitions.find((entry) => entry.id === node.definition) : null;
    if (item) return `${node.label} → ${item.kind === "loop" ? "루프" : "하네스"} ${item.name} (${workflowRoleSummary(item.id, definitions)})`;
    if (node.type === "agent" && !node.definition && edges.some((edge) => edge.to === node.id && edge.port === "profile")) return `${node.label} → 에이전트 프로필`;
    return `${node.label} → 연결 안 됨`;
  });
}

function bindMapWorkflowLaunch() {
  const button = $("workflow-new-run"), dialog = $("workflow-launch"), form = $("workflow-launch-form");
  const status = $("workflow-launch-status"), source = form.elements.source, project = form.elements.project;
  const submit = form.querySelector("button[type=submit]");
  const agents = $("workflow-launch-agents");
  const roles = ["author", "reviewer", "triage", "loop"];
  const optional = new Set(["triage"]); // 고르지 않으면 설계·문서 하네스가 대신한다.
  let definitions = [], presets = [], saved = [], generation = 0, pending = false, requestKey, runtime = null, returnToDesign = false, lastProject = "";
  const timeoutOf = () => Number(form.elements.minutes.value) * 60000;
  // 실행 환경 인증에 따라 안내한다. Claude Code 로그인이 시간 제한 안에 만료되면 시작 전에 알린다.
  function showRuntime() {
    const warning = engineeringLoginWarning(runtime, timeoutOf());
    if (warning) status.textContent = warning;
    status.dataset.tone = warning ? "warn" : "";
    engineeringApplyBudgetWording(runtime, dialog);
  }
  const option = ({ id, name, version }) => new Option(name + (version ? " · v" + version : ""), id);
  function usePreset() { return presets.find(({ id }) => source.value === "preset:" + id); }
  const steps = $("workflow-launch-steps"), stepDetails = new Map();
  const showSteps = (lines) => {
    steps.replaceChildren(...lines.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    steps.hidden = !lines.length;
  };
  // 저장된 Workflow 를 고르면 그 단계 목록을 불러 보여 준다. 같은 Workflow 는 한 번만 부르고, 요청 중 선택이 바뀌면 결과를 버린다.
  async function refreshSteps() {
    const choice = !usePreset() && source.value.startsWith("saved:") ? saved.find(({ id }) => "saved:" + id === source.value) : null;
    if (!choice) return showSteps([]);
    const key = [project.value, choice.id, choice.version].join("@"), revision = generation, wanted = source.value;
    if (!stepDetails.has(key)) {
      showSteps([]);
      stepDetails.set(key, mapWorkflowRequest("workflow", { project: project.value, id: choice.id, version: choice.version }));
    }
    try {
      const detail = await stepDetails.get(key);
      if (revision === generation && source.value === wanted) showSteps(workflowStepSummaries(detail.payload, definitions));
    } catch {
      stepDetails.delete(key);
      if (revision === generation && source.value === wanted) showSteps([]);
    }
  }
  function refreshControls() {
    const preset = usePreset();
    const selectedAuthor = form.elements.author.value;
    for (const role of roles) {
      const control = form.elements[role];
      const previous = control.value;
      const visible = Boolean(preset?.[role]);
      control.disabled = !visible;
      control.required = visible && !optional.has(role);
      control.closest("label").hidden = !visible;      const choices = definitions.filter(({ kind, id }) => kind === (role === "loop" ? "loop" : "harness") &&
        !(role === "reviewer" && preset?.author && id === (form.elements.author.value || selectedAuthor)));
      control.replaceChildren(new Option("선택해 주세요", ""), ...choices.map((entry) => option({ ...entry, name: engineeringDefinitionLabel(entry) })));
      const suggested = choices.find(({ name }) => name === preset?.suggest?.[role])?.id;
      const manual = previous && previous !== control.dataset.auto && choices.some(({ id }) => id === previous);
      if (manual) control.value = previous;
      else if (suggested) control.value = suggested;
      else if (choices.length === 1 && !optional.has(role)) control.value = choices[0].id;
      control.dataset.auto = !manual && control.value ? control.value : "";
      control.closest("label").querySelector(".wf-role-summary").textContent = workflowRoleSummary(control.value, definitions);
    }
    agents.hidden = roles.every((role) => form.elements[role].closest("label").hidden) && (preset || !source.value.startsWith("saved:"));
    void refreshSteps();
    const missing = roles.filter((role) => !optional.has(role) && preset?.[role] && !form.elements[role].value);
    if (missing.length) status.textContent = "붙일 에이전트에서 필요한 하네스와 Loop를 골라 주세요. 목록에는 개인, 이 프로젝트의 팀, 이 프로젝트에 저장된 하네스가 표시됩니다.";
    submit.disabled = pending || !project.value || !source.value || missing.length > 0;
  }
  async function loadProject(preferredWorkflow) {
    const value = project.value, revision = ++generation;
    lastProject = value;
    submit.disabled = true;
    status.textContent = "";
    definitions = [];
    saved = [];
    source.replaceChildren();
    $("workflow-launch-engineering").href = "/engineering.html?" + new URLSearchParams({ project: value });
    if (!value) return refreshControls();
    try {
      const data = await Promise.all(["definitions", "workflows"].map((endpoint) => mapWorkflowRequest(endpoint, { project: value })));
      if (revision !== generation) return;
      [definitions, saved] = data;
      void mapWorkflowRequest("runtime").then((current) => {
        if (revision !== generation) return;
        runtime = current;
        showRuntime();
      }).catch(() => {});
      // 템플릿, 사용자가 저장한 Workflow, 템플릿 빠른 실행이 만든 자동 사본을 따로 묶는다.
      // 자동 사본은 그 사본으로 돈 실행에서 '이 Workflow로 새 실행'을 눌렀을 때만 보여 준다(평소에는 템플릿을 고르면 된다).
      const named = saved.filter(({ generated }) => !generated);
      const copy = saved.find(({ id, generated }) => generated && id === preferredWorkflow);
      const group = (label, items) => {
        const element = document.createElement("optgroup");
        element.label = label;
        element.append(...items);
        return element;
      };
      source.append(group("템플릿 · 붙일 에이전트를 고름", presets.map((item) => new Option(item.name + " · 템플릿", "preset:" + item.id))));
      if (named.length) source.append(group("저장된 Workflow", named.map((item) => option({ ...item, id: "saved:" + item.id }))));
      if (copy) source.append(group("빠른 실행 사본(자동 생성)", [new Option(engineeringWorkflowLabel(copy), "saved:" + copy.id)]));
      const hiddenCopies = saved.length - named.length - (copy ? 1 : 0);
      source.title = hiddenCopies ? "템플릿 빠른 실행이 만든 자동 사본 " + hiddenCopies + "개는 목록에서 뛴니다." : "";
      if (copy) source.value = "saved:" + copy.id;
      else if (typeof preferredWorkflow === "string" && named.some(({ id }) => id === preferredWorkflow)) source.value = "saved:" + preferredWorkflow;
      else if (named.length) source.value = "saved:" + named[0].id;
      else if (presets.some(({ id }) => id === "bugfix")) source.value = "preset:bugfix";
      refreshControls();
    } catch (error) { if (revision === generation) status.textContent = error.message; }
  }
  button.hidden = false;
  // 설계 화면에서 열면 프로젝트·Workflow는 캔버스에서 이미 골랐으므로 보여 주기만 한다.
  function lockSelection(locked) {
    project.disabled = locked;
    source.disabled = locked;
    dialog.dataset.fromDesign = locked ? "1" : "";
    $("workflow-launch-engineering").hidden = locked;
  }
  // 등록된 프로젝트, 아직 등록하지 않은 세션 작업 폴더, 폴더 선택 항목을 채운다. 등록된 프로젝트가 있으면 true.
  function fillProjects(projects, preferred) {
    const normal = (path) => String(path).toLowerCase().replaceAll("\\", "/").replace(/\/+$/, "");
    const active = projects.filter(({ archived }) => !archived);
    const known = new Set(active.map(({ root }) => normal(root)));
    const found = new Map();
    for (const path of typeof cwdSessions === "function" ? cwdSessions() : []) if (!known.has(normal(path))) found.set(normal(path), path);
    const folders = [...found.values()].map((path) => new Option(`${path.split(/[\\/]/).filter(Boolean).pop() || path} · 처음 실행 (${path})`, "folder:" + path));
    lastProject = "";
    project.replaceChildren();
    for (const [label, items] of [["프로젝트", active.map(option)], ["세션 폴더", folders]]) {
      if (!items.length) continue;
      const element = document.createElement("optgroup");
      element.label = label;
      element.append(...items);
      project.append(element);
    }
    if (window.engineeringDesktop?.pickFolder) project.append(new Option("폴더 선택…", "pick:"));
    if (preferred && [...project.options].some(({ value }) => value === preferred)) project.value = preferred;
    // 등록된 프로젝트가 없으면 아무것도 고르지 않은 채로 둔다. 첫 폴더가 미리 골라져 있으면 그 폴더를 다시 골라도 onchange 가 뜨지 않는다.
    if (!active.length) project.selectedIndex = -1;
    return active.length > 0;
  }
  // 고른 폴더를 프로젝트로 등록하고 목록을 다시 채운 뒤 그 프로젝트를 불러온다. 실패하면 이전 선택으로 되돌린다.
  async function adoptFolder(value) {
    const revision = ++generation;
    submit.disabled = true;
    status.textContent = "폴더를 프로젝트로 등록하는 중입니다.";
    try {
      let created;
      if (value === "pick:") {
        const picked = await window.engineeringDesktop.pickFolder();
        if (!picked.ok) throw new Error(picked.error || "폴더를 고르지 않았습니다.");
        created = await mapWorkflowRequest("projects/register-picked", {}, { root: picked.value });
      } else created = await mapWorkflowRequest("projects/ensure", {}, { root: value.slice(7) });
      if (revision !== generation) return;
      const projects = await mapWorkflowRequest("projects");
      if (revision !== generation) return;
      fillProjects(projects, created.id);
      await loadProject();
      if (!status.textContent) status.textContent = `${created.name} 폴더를 프로젝트로 등록했습니다.`;
    } catch (error) {
      if (revision !== generation) return;
      status.textContent = error.message;
      project.value = lastProject;
      refreshControls();
    }
  }
  async function open(preferredProject, preferredWorkflow, options) {
    if (dialog.open) return;
    returnToDesign = Boolean(options?.returnToDesign);
    lockSelection(returnToDesign);
    dialog.showModal();
    const revision = ++generation;
    project.replaceChildren();
    source.replaceChildren();
    submit.disabled = true;
    status.textContent = "프로젝트와 템플릿을 불러오는 중입니다.";
    try {
      const [projects, templates] = await Promise.all(["projects", "workflows/presets"].map((endpoint) => mapWorkflowRequest(endpoint)));
      if (revision !== generation) return;
      presets = templates;
      if (!fillProjects(projects, preferredProject)) { status.textContent = "작업할 폴더를 고르면 그 자리에서 프로젝트로 등록합니다."; return; }
      await loadProject(preferredWorkflow);
    } catch (error) { if (revision === generation) status.textContent = error.message; }
  }
  button.onclick = () => {
    if (!wfMap.edit || wfLeaveEditing()) void open();
  };
  $("workflow-launch-close").onclick = () => { if (!pending) dialog.close(); };
  dialog.addEventListener("cancel", (event) => { if (pending) event.preventDefault(); });
  dialog.addEventListener("close", () => { generation++; returnToDesign = false; lockSelection(false); });
  project.onchange = () => {
    if (project.value.startsWith("folder:") || project.value.startsWith("pick:")) void adoptFolder(project.value);
    else void loadProject();
  };
  for (const control of [source, ...roles.map((role) => form.elements[role])]) control.onchange = () => {
    status.textContent = "";
    refreshControls();
    showRuntime();
  };
  form.elements.minutes.addEventListener("change", () => { status.textContent = ""; showRuntime(); });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(form);
    const goal = fields.get("goal");
    const input = { project: project.value, title: fields.get("title").trim() || goal.trim().split(/\r?\n/)[0].slice(0, 240), goal,
      // 비우면 기본 문장을 쓴다(first-run.js 의 QUICK_ACCEPTANCE 와 같은 문장).
      acceptance: fields.get("acceptance").trim() || "작업 목표를 끝내고, 기존 기능과 테스트가 깨지지 않는다.", timeoutMs: Number(fields.get("minutes")) * 60000, budgetCents: Number(fields.get("budget")) };
    const preset = usePreset();
    if (preset) {
      input.preset = preset.id;
      input.refs = Object.fromEntries(roles.filter((role) => preset[role] && fields.get(role)).map((role) => {
        const item = definitions.find(({ id }) => id === fields.get(role));
        return [role, { id: item.id, version: item.version }];
      }));
    } else {
      const choice = saved.find(({ id }) => "saved:" + id === source.value);
      if (!choice) return;
      input.workflow = choice.id;
      input.version = choice.version;
    }
    const signature = JSON.stringify(input);
    pending = true;
    submit.disabled = true;
    runtime = await mapWorkflowRequest("runtime").catch(() => runtime);
    const warning = engineeringLoginWarning(runtime, input.timeoutMs);
    if (warning && !window.confirm(warning + "\n\n그래도 실행할까요?")) {
      pending = false;
      refreshControls();
      showRuntime();
      return;
    }
    if (requestKey?.signature !== signature) requestKey = { signature, key: crypto.randomUUID() };
    status.textContent = "실행을 준비하는 중입니다.";
    try {
      const run = await mapWorkflowRequest("workflows/launch", {}, { ...input, key: requestKey.key });
      requestKey = undefined;
      const watchOnDesign = returnToDesign;
      dialog.close();
      if (typeof refreshWorkflowQueue === "function") void refreshWorkflowQueue();
      if (typeof openMapWorkflow === "function") void openMapWorkflow(run.id, undefined, { design: watchOnDesign });
      else location.href = "/?" + new URLSearchParams({ run: run.id });
    } catch (error) { status.textContent = error.message; }
    finally { pending = false; refreshControls(); }
  };
  return open;
}
const openMapWorkflowLaunch = window.engineeringDesktop ? bindMapWorkflowLaunch() : null;
