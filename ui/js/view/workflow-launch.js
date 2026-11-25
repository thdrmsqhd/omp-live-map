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
  const roles = ["author", "reviewer", "loop"];
  let definitions = [], presets = [], saved = [], generation = 0, pending = false, requestKey;
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
      control.required = visible;
      control.closest("label").hidden = !visible;
      const choices = definitions.filter(({ kind, id }) => kind === (role === "loop" ? "loop" : "harness") &&
        !(role === "reviewer" && preset?.author && id === (form.elements.author.value || selectedAuthor)));
      control.replaceChildren(new Option("선택해 주세요", ""), ...choices.map(option));
      if (choices.some(({ id }) => id === previous)) control.value = previous;
      else if (choices.length === 1) control.value = choices[0].id;
    }
    const missing = roles.filter((role) => preset?.[role] && !form.elements[role].value);
    if (missing.length) {
      settings.open = true;
      status.textContent = "실행 설정에서 필요한 하네스와 Loop를 선택해 주세요. 목록이 비어 있으면 실행 환경 설정에서 추가합니다.";
    }
    submit.disabled = pending || !project.value || !source.value || missing.length > 0;
  }
  async function loadProject() {
    const value = project.value, revision = ++generation;
    submit.disabled = true;
    status.textContent = "";
    definitions = [];
    saved = [];
    source.replaceChildren();
    $("workflow-launch-engineering").href = "/engineering.html?" + new URLSearchParams({ project: value, view: "design" });
    if (!value) return refreshControls();
    try {
      const data = await Promise.all(["definitions", "workflows"].map((endpoint) => mapWorkflowRequest(endpoint, { project: value })));
      if (revision !== generation) return;
      [definitions, saved] = data;
      void mapWorkflowRequest("runtime").catch(() => {});
      const templates = document.createElement("optgroup");
      templates.label = "기본 템플릿";
      templates.append(...presets.map((item) => option({ ...item, id: "preset:" + item.id })));
      const workflows = document.createElement("optgroup");
      workflows.label = "저장된 Workflow";
      workflows.append(...saved.map((item) => option({ ...item, id: "saved:" + item.id })));
      source.append(templates, workflows);
      if (saved.length) source.value = "saved:" + saved[0].id;
      else if (presets.some(({ id }) => id === "bugfix")) source.value = "preset:bugfix";
      refreshControls();
    } catch (error) { if (revision === generation) status.textContent = error.message; }
  }
  button.hidden = false;
  button.onclick = async () => {
    dialog.showModal();
    submit.disabled = true;
    status.textContent = "프로젝트와 템플릿을 불러오는 중입니다.";
    try {
      const [projects, templates] = await Promise.all(["projects", "workflows/presets"].map((endpoint) => mapWorkflowRequest(endpoint)));
      presets = templates;
      project.replaceChildren(...projects.filter(({ archived }) => !archived).map(option));
      if (!project.value) { status.textContent = "Engineering에서 프로젝트를 등록해 주세요."; return; }
      await loadProject();
    } catch (error) { status.textContent = error.message; }
  };
  $("workflow-launch-close").onclick = () => { if (!pending) dialog.close(); };
  dialog.addEventListener("cancel", (event) => { if (pending) event.preventDefault(); });
  project.onchange = loadProject;
  for (const control of [source, ...roles.map((role) => form.elements[role])]) control.onchange = () => {
    status.textContent = "";
    refreshControls();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(form);
    const input = { project: project.value, title: fields.get("title"), goal: fields.get("goal"),
      acceptance: fields.get("acceptance"), timeoutMs: Number(fields.get("minutes")) * 60000, budgetCents: Number(fields.get("budget")) };
    const preset = usePreset();
    if (preset) {
      input.preset = preset.id;
      input.refs = Object.fromEntries(roles.filter((role) => preset[role]).map((role) => {
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
    if (requestKey?.signature !== signature) requestKey = { signature, key: crypto.randomUUID() };
    pending = true;
    submit.disabled = true;
    status.textContent = "실행을 준비하는 중입니다.";
    try {
      const run = await mapWorkflowRequest("workflows/launch", {}, { ...input, key: requestKey.key });
      requestKey = undefined;
      dialog.close();
      if (typeof openMapWorkflow === "function") void openMapWorkflow(run.id);
      else location.href = "/engineering.html?" + new URLSearchParams({ project: run.project, view: "workflow", run: run.id });
    } catch (error) { status.textContent = error.message; }
    finally { pending = false; refreshControls(); }
  };
}
if (window.engineeringDesktop) bindMapWorkflowLaunch();
