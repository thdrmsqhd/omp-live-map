/* Workflow 시작 폼. 실제 Workflows API를 통해 저장된 실행기를 사용한다. */
async function mapWorkflowRequest(endpoint, params, payload) {
  const result = await window.engineeringDesktop.request(endpoint, params ?? {}, payload);
  if (!result.ok) throw new Error(result.error || "Workflow 요청에 실패했습니다.");
  return result.value;
}

function bindMapWorkflowLaunch() {
  const button = $("workflow-new-run"), dialog = $("workflow-launch"), form = $("workflow-launch-form");
  const status = $("workflow-launch-status"), source = form.elements.source, project = form.elements.project;
  const submit = form.querySelector("button[type=submit]");
  const settings = $("workflow-launch-settings");
  const roles = ["author", "reviewer", "triage", "loop"];
  const optional = new Set(["triage"]); // 고르지 않으면 설계·문서 하네스가 대신한다.
  let definitions = [], presets = [], saved = [], generation = 0, pending = false, requestKey, runtime = null;
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
  function refreshControls() {
    const preset = usePreset();
    const selectedAuthor = form.elements.author.value;
    for (const role of roles) {
      const control = form.elements[role];
      const previous = control.value;
      const visible = Boolean(preset?.[role]);
      control.disabled = !visible;
      control.required = visible && !optional.has(role);
      control.closest("label").hidden = !visible;
      const choices = definitions.filter(({ kind, id }) => kind === (role === "loop" ? "loop" : "harness") &&
        !(role === "reviewer" && preset?.author && id === (form.elements.author.value || selectedAuthor)));
      control.replaceChildren(new Option("선택해 주세요", ""), ...choices.map((entry) => option({ ...entry, name: engineeringDefinitionLabel(entry) })));
      const suggested = choices.find(({ name }) => name === preset?.suggest?.[role])?.id;
      const manual = previous && previous !== control.dataset.auto && choices.some(({ id }) => id === previous);
      if (manual) control.value = previous;
      else if (suggested) control.value = suggested;
      else if (choices.length === 1 && !optional.has(role)) control.value = choices[0].id;
      control.dataset.auto = !manual && control.value ? control.value : "";
    }
    const missing = roles.filter((role) => !optional.has(role) && preset?.[role] && !form.elements[role].value);
    if (missing.length) {
      settings.open = true;
      status.textContent = "실행 설정에서 필요한 하네스와 Loop를 선택해 주세요. 목록에는 개인, 이 프로젝트의 팀, 이 프로젝트에 저장된 하네스가 표시됩니다.";
    }
    submit.disabled = pending || !project.value || !source.value || missing.length > 0;
  }
  async function loadProject(preferredWorkflow) {
    const value = project.value, revision = ++generation;
    submit.disabled = true;
    status.textContent = "";
    definitions = [];
    saved = [];
    source.replaceChildren();
    $("workflow-launch-engineering").href = "/engineering.html?" + new URLSearchParams({ project: value, view: "studio" });
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
      source.append(group("템플릿 · 실행 설정에서 하네스를 고름", presets.map((item) => new Option(item.name + " · 템플릿", "preset:" + item.id))));
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
  async function open(preferredProject, preferredWorkflow) {
    if (dialog.open) return;
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
      project.replaceChildren(...projects.filter(({ archived }) => !archived).map(option));
      if (preferredProject && [...project.options].some(({ value }) => value === preferredProject)) project.value = preferredProject;
      if (!project.value) { status.textContent = "Engineering에서 프로젝트를 등록해 주세요."; return; }
      await loadProject(preferredWorkflow);
    } catch (error) { if (revision === generation) status.textContent = error.message; }
  }
  button.onclick = () => {
    if (!wfMap.edit || wfLeaveEditing()) void open();
  };
  $("workflow-launch-close").onclick = () => { if (!pending) dialog.close(); };
  dialog.addEventListener("cancel", (event) => { if (pending) event.preventDefault(); });
  dialog.addEventListener("close", () => { generation++; });
  project.onchange = () => void loadProject();
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
      acceptance: fields.get("acceptance"), timeoutMs: Number(fields.get("minutes")) * 60000, budgetCents: Number(fields.get("budget")) };
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
      dialog.close();
      if (typeof refreshWorkflowQueue === "function") void refreshWorkflowQueue();
      if (typeof openMapWorkflow === "function") void openMapWorkflow(run.id);
      else location.href = "/?" + new URLSearchParams({ run: run.id });
    } catch (error) { status.textContent = error.message; }
    finally { pending = false; refreshControls(); }
  };
  return open;
}
const openMapWorkflowLaunch = window.engineeringDesktop ? bindMapWorkflowLaunch() : null;
