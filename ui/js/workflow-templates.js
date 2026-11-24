export function bindTemplateButtons({ el, request, report, current, projectId, imported }) {
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
