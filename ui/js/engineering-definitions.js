import { bindHarnessTrials } from "./harness-trials.js";
import { bindHarnessPreview } from "./harness-preview.js";
import { bindHarnessEditor } from "./harness-editor.js";

export function bindDefinitionEditor({ find, request, report, options, definitions: entries, refreshDefinitions, owner, canPreview, openScope }) {
  const kind = find("kind");
  const project = find("project");
  const definition = find("definition");
  function defaultPayload() {
    const model = entries().find((entry) => entry.kind === "model");
    const harness = entries().find((entry) => entry.kind === "harness");
    if (kind.value === "model") return { name: "Claude Sonnet 4.6", provider: "anthropic", model: "claude-sonnet-4-6", reasoning: "" };
    if (kind.value === "harness") return { name: "Claude Code", adapter: "claude", model: model?.id ?? "", role: "개발", instructions: "", assets: { agents: "", skills: [], mcp: {}, hooks: {} } };
    return { name: "", harness: harness?.id ?? "", attempts: 3, timeoutMs: 600000, budgetCents: 300,
      checks: [{ command: "node", args: ["--test"], code: 0 }] };
  }

  const harnessEditor = bindHarnessEditor({ find, options, newProfile(payload, models, preserveDraft) {
    if (!preserveDraft && !mayReplace()) return;
    definition.value = "";
    showDefinition();
    harnessEditor.show(payload, models, true, true);
  } });
  const preview = bindHarnessPreview({ find, request, payload: harnessEditor.payload,
    project: () => canPreview() ? project.value : "", saved: () => definition.value ? {
      id: definition.value, version: Number(find("definition-version").value),
    } : null,
  });
  const trial = bindHarnessTrials({ find, request, options, payload: harnessEditor.payload,
    project: () => canPreview() ? project.value : "", entries: () => entries().filter(({ kind }) => kind === "harness"),
    selected: () => definition.value,
  });
  const selection = [project, find("definition-team"), kind, definition, find("definition-version")];
  const priorSelection = new Map();
  function rememberSelection() {
    for (const control of selection) priorSelection.set(control, control.value);
  }
  function mayReplace(control) {
    if (harnessEditor.dirty() && !window.confirm("저장하지 않은 하네스 변경 사항을 지우시겠습니까?")) {
      if (control) control.value = priorSelection.get(control) ?? "";
      return false;
    }
    return true;
  }

  function resetTools() {
    preview.reset();
    trial.update();
    const available = canPreview();
    for (const id of ["harness-preview-open", "harness-preview-saved", "trial-start"]) {
      find(id).title = available ? "" : "이 하네스를 사용할 작업 프로젝트를 선택해 주세요.";
    }
  }

  function showDefinition() {
    const selected = entries().find((entry) => entry.id === definition.value);
    find("payload").value = JSON.stringify(selected?.payload ?? defaultPayload(), null, 2);
    const destination = owner();
    find("remove").disabled = !selected || destination.archived;
    find("definition-save").disabled = Boolean(destination.archived);
    find("definition-save").textContent = (selected ? "새 버전 저장 · " : "새로 저장 · ") + destination.label;
    find("definition-diff").hidden = true;
    find("harness-uses").hidden = kind.value !== "harness" || !selected || !canPreview();
    const versions = find("definition-version");
    versions.replaceChildren();
    for (let version = selected?.version ?? 0; version > 0; version--) versions.add(new Option(String(version), String(version)));
    versions.disabled = !selected;
    harnessEditor.show(selected?.payload ?? defaultPayload(), entries().filter((entry) => entry.kind === "model"), kind.value === "harness");
    resetTools();
    rememberSelection();
    if (!find("harness-uses").hidden && find("harness-uses").open) void refreshUses();
  }

  kind.addEventListener("change", report(async () => { if (mayReplace(kind)) await refreshDefinitions(""); }));
  definition.addEventListener("change", () => { if (mayReplace(definition)) showDefinition(); });
  const selectVersion = report(async (event) => {
    const selected = entries().find((entry) => entry.id === definition.value);
    if (!selected || !mayReplace(event.currentTarget)) return;
    const requestedVersion = event.currentTarget.value;
    const draft = harnessEditor.revision();
    const historical = await request("definitions/version", { id: selected.id, version: requestedVersion });
    if (definition.value !== selected.id || find("definition-version").value !== requestedVersion || harnessEditor.revision() !== draft) return;
    const previous = JSON.stringify(historical.payload, null, 2);
    const current = JSON.stringify(selected.payload, null, 2);
    find("payload").value = previous;
    harnessEditor.show(historical.payload, entries().filter((entry) => entry.kind === "model"), kind.value === "harness");
    resetTools();
    rememberSelection();
    if (find("harness-uses").open) void refreshUses();
    const diff = find("definition-diff");
    diff.hidden = current === previous;
    if (!diff.hidden) diff.textContent = `현재 버전 ${selected.version}\n${current}\n\n선택한 버전 ${historical.version}\n${previous}`;
  });
  find("definition-version").addEventListener("change", selectVersion);
  find("definition-form").addEventListener("submit", report(async (event) => {
    const old = entries().find((entry) => entry.id === definition.value);
    const payload = kind.value === "harness" ? harnessEditor.payload() : JSON.parse(new FormData(event.currentTarget).get("payload"));
    const { scope, project: projectId, team } = owner();
    const saved = await request("definitions", {}, { scope, project: projectId, team,
      kind: kind.value, payload, id: old?.id, version: old?.version });
    await refreshDefinitions(saved.id, true);
  }));
  find("remove").addEventListener("click", report(async () => {
    if (!mayReplace()) return;
    await request("definitions/remove", {}, { id: definition.value });
    await refreshDefinitions("", true);
  }));
  let usesRevision = 0;
  async function refreshUses() {
    const list = find("harness-uses-list");
    list.replaceChildren();
    const id = definition.value;
    const owner = project.value;
    const revision = ++usesRevision;
    if (!id || !owner || kind.value !== "harness") return;
    try {
      const uses = await request("harness/uses", { project: owner, id });
      if (revision !== usesRevision || definition.value !== id || project.value !== owner || kind.value !== "harness") return;
      if (!uses.length) {
        const item = document.createElement("li");
        item.textContent = "연결된 Workflow가 없습니다.";
        list.append(item);
      }
      for (const row of uses) {
        const item = document.createElement("li");
        item.textContent = row.name + " v" + row.version + " · 노드 " + row.node + " · " +
          (row.loop ? row.loopName + " v" + row.loopVersion + " → " : "") + "하네스 v" + row.harnessVersion;
        const targetVersion = Number(find("definition-version").value);
        if (targetVersion && targetVersion !== row.harnessVersion) {
          const apply = document.createElement("button");
          apply.type = "button";
          apply.textContent = "v" + targetVersion + " 적용";
          apply.addEventListener("click", report(async () => {
            const loop = row.loop ? " 연결된 Loop의 새 버전도 함께 저장합니다." : "";
            if (!window.confirm(row.name + " v" + row.version + "의 " + row.node + " 노드에서 하네스 v" +
              row.harnessVersion + " → v" + targetVersion + "을 적용하고 새 Workflow 버전을 저장할까요?" + loop)) return;
            apply.disabled = true;
            try {
              const result = await request("harness/apply", {}, { project: owner, workflow: row.workflow,
                version: row.version, node: row.node, harness: id, harnessVersion: targetVersion });
              find("status").textContent = "Workflow v" + result.workflow.version + " 저장됨" +
                (result.loop ? " · Loop v" + result.loop.version + " 저장됨" : "");
              await refreshUses();
            } finally { apply.disabled = false; }
          }));
          item.append(" ", apply);
        }
        list.append(item);
      }
    } catch (error) {
      if (revision !== usesRevision) return;
      const item = document.createElement("li");
      item.textContent = error.message;
      list.replaceChildren(item);
    }
  }
  const uses = find("harness-uses");
  uses.addEventListener("toggle", () => { if (uses.open) void refreshUses(); });
  return {
    mayReplace,
    async open(id, version) {
      if (!mayReplace()) return;
      openScope(id);
      kind.value = "harness";
      await refreshDefinitions(id);
      const control = find("definition-version");
      if (version && version !== Number(control.value)) {
        control.value = String(version);
        await selectVersion({ currentTarget: control });
      }
      find("design-nav").click();
    },
    select(chosen) {
      options(definition, entries().filter((entry) => entry.kind === kind.value), kind.value === "harness" ? "새 하네스" : "새 정의", chosen);
      showDefinition();
    },
  };
}
