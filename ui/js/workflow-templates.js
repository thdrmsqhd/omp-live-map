export function bindTemplateButtons({ el, request, report, definitions, current, projectId, isArchived, addWorkflowDefaults, imported }) {
  const presetForm = el("preset-form");
  const defaults = el("preset-defaults");
  const hint = el("preset-hint");
  const fields = ["author", "reviewer", "loop"];
  const selectedPreset = () => presets.find(({ id }) => id === presetForm.elements.preset.value);
  let presets = [];
  let adding = false;
  let preferred = {};

  function updatePresetActions() {
    const chosen = selectedPreset();
    const missing = fields.filter((field) => chosen?.[field] && !presetForm.elements[field].value);
    const sameHarness = chosen?.author && chosen?.reviewer && !missing.length &&
      presetForm.elements.author.value === presetForm.elements.reviewer.value;
    const editable = Boolean(projectId()) && !isArchived();
    defaults.disabled = !editable || !chosen || adding;
    presetForm.elements.create.disabled = !editable || !chosen || adding || missing.length > 0 || Boolean(sameHarness);
    hint.textContent = !projectId() ? "위에서 작업 프로젝트를 선택하세요. 프로젝트가 없으면 ‘프로젝트 설정’에서 등록할 수 있습니다."
      : isArchived() ? "보관된 프로젝트에는 Workflow를 추가할 수 없습니다."
      : adding ? "개인 기본 설정을 만드는 중입니다."
      : sameHarness ? "설계와 리뷰에는 서로 다른 하네스를 선택하세요."
      : missing.length ? "필요한 하네스와 루프를 선택하세요. 목록이 비어 있으면 ‘기본 하네스·Loop 추가’를 눌러 준비할 수 있습니다." : "";
  }

  function showPreset() {
    const selected = selectedPreset();
    for (const field of fields) {
      const select = presetForm.elements[field], current = select.value;
      const options = definitions().filter(({ kind }) => kind === (field === "loop" ? "loop" : "harness"));
      const placeholder = !selected?.[field] ? "사용 안 함" : options.length ? "선택" : "등록된 항목 없음";
      select.replaceChildren(new Option(placeholder, ""), ...options.map((entry) => new Option(engineeringDefinitionLabel(entry), entry.id)));
      const wanted = field === "loop" ? (preferred.loops?.[selected?.id] ?? preferred.loop) : preferred[field];
      const previous = current || (selected?.[field] ? wanted : "");
      if (options.some(({ id }) => id === previous)) select.value = previous;
      select.required = Boolean(selected?.[field]);
      select.disabled = !selected?.[field] || !projectId() || isArchived();
    }
    updatePresetActions();
  }
  presetForm.closest("details").addEventListener("toggle", report(async (event) => {
    if (!event.target.open) return;
    if (!presets.length) {
      presets = await request("workflows/presets");
      presetForm.elements.preset.replaceChildren(...presets.map(({ id, name }) => new Option(name, id)));
    }
    showPreset();
  }));
  presetForm.elements.preset.onchange = () => {
    // 앱이 제안한 루프를 그대로 두었다면 새 템플릿에 맞는 루프로 바꾼다. 직접 고른 루프는 유지한다.
    const loop = presetForm.elements.loop;
    if ([preferred.loop, ...Object.values(preferred.loops ?? {})].includes(loop.value)) loop.value = "";
    showPreset();
  };
  for (const field of fields) presetForm.elements[field].onchange = updatePresetActions;
  defaults.onclick = report(async () => {
    const project = projectId();
    adding = true;
    updatePresetActions();
    try {
      await addWorkflowDefaults(project);
      if (project !== projectId()) return;
      el("status").textContent = "개인 기본 하네스와 루프를 사용할 수 있습니다.";
    } finally {
      adding = false;
      updatePresetActions();
    }
  });
  presetForm.addEventListener("submit", report(async (event) => {
    if (presetForm.elements.create.disabled) return;
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
  return { refresh: showPreset, useDefaults(refs) {
    preferred = refs;
    showPreset();
  }, clear() {
    preferred = {};
    for (const field of fields) presetForm.elements[field].value = "";
  } };
}
