export function bindTemplateButtons({ el, request, report, definitions, current, projectId, imported }) {
  const presetForm = el("preset-form");
  let presets = [];

  function showPreset() {
    const selected = presets.find(({ id }) => id === presetForm.elements.preset.value);
    for (const field of ["author", "reviewer", "loop"]) {
      const select = presetForm.elements[field], current = select.value;
      const options = definitions().filter(({ kind }) => kind === (field === "loop" ? "loop" : "harness"));
      select.replaceChildren(new Option("선택", ""), ...options.map(({ id, name }) => new Option(name, id)));
      if (options.some(({ id }) => id === current)) select.value = current;
      select.required = Boolean(selected?.[field]);
      select.disabled = !selected?.[field];
    }
  }
  presetForm.closest("details").addEventListener("toggle", report(async (event) => {
    if (!event.target.open) return;
    if (!presets.length) {
      presets = await request("workflows/presets");
      presetForm.elements.preset.replaceChildren(...presets.map(({ id, name }) => new Option(name, id)));
    }
    showPreset();
  }));
  presetForm.elements.preset.onchange = showPreset;
  presetForm.addEventListener("submit", report(async (event) => {
    const { preset, name, author, reviewer, loop } = Object.fromEntries(new FormData(event.currentTarget));
    if (!projectId()) throw new Error("프로젝트를 선택해 주세요.");
    const record = await request("workflows/presets", {}, { project: projectId(), preset, name, refs: { author, reviewer, loop } });
    await imported(record);
  }));
  el("export").addEventListener("click", report(async () => {
    const workflow = current();
    if (!workflow) throw new Error("내보낼 Workflow 버전을 먼저 선택해 주세요.");
    const template = await request("workflows/export", {
      project: projectId(), id: workflow.id, version: String(workflow.version),
    });
    const resource = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = resource;
    link.download = workflow.name.replace(/[<>:"/\\|?*]/g, "-") + ".workflow.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(resource), 1000);
  }));

  el("import").addEventListener("click", report(async () => {
    const project = projectId();
    const file = el("import-file").files[0];
    if (!project || !file || file.size > 60 * 1024) throw new Error("프로젝트와 60KiB 이하의 Workflow 템플릿을 선택해 주세요.");
    const record = await request("workflows/import", {}, {
      project, name: el("import-name").value.trim(), template: JSON.parse(await file.text()),
    });
    if (project !== projectId()) return;
    el("import-file").value = "";
    el("import-name").value = "";
    await imported(record);
  }));
}
