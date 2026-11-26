import { bindHarnessTrials } from "./harness-trials.js";
import { bindHarnessPreview } from "./harness-preview.js";
import { bindHarnessEditor } from "./harness-editor.js";
import { bindLoopFields } from "./engineering-loop-fields.js";
import { modelKey, showModelOptions } from "./engineering-model-options.js";

export function bindDefinitionEditor({ find, request, report, options, definitions: entries, refreshDefinitions, owner, canPreview, openScope, models, availableHarnesses }) {
  const kind = find("kind");
  const project = find("project");
  const definition = find("definition");
  const loopFields = bindLoopFields(find, options);
  const modelFields = find("definition-model-fields");
  const form = find("definition-form");
  const controls = form.elements;
  let initialDefinition = "";
  function definitionFingerprint() {
    const fields = kind.value === "loop" ? loopFields.payload()
      : [controls.modelName.value, controls.catalogModel.value, controls.reasoning.value];
    return JSON.stringify(fields);
  }
  function defaultPayload() {
    const model = entries().find((entry) => entry.kind === "model");
    const harness = availableHarnesses()[0];
    if (kind.value === "model") return { name: "Claude Sonnet 5.5", provider: "anthropic", model: "claude-sonnet-5-5", reasoning: "" };
    if (kind.value === "harness") return { name: "Claude Code", adapter: "claude", model: model?.id ?? "", role: "개발", instructions: "", assets: { agents: "", skills: [], mcp: {}, hooks: {} } };
    return { name: "", harness: harness?.id ?? "", attempts: 3, timeoutMs: 600000, budgetCents: 300,
      checks: [{ command: "node", args: ["--test"], code: 0 }] };
  }

  const showFields = (payload) => {
    modelFields.disabled = modelFields.hidden = kind.value !== "model";
    if (kind.value === "model") {
      controls.modelName.value = payload.name;
      controls.reasoning.value = payload.reasoning;
      showModelOptions(controls.catalogModel, models(), modelKey(payload.provider, payload.model), "모델 선택");
    }
    loopFields.show(payload, availableHarnesses(), kind.value === "loop");
    harnessEditor.show(payload, entries().filter((entry) => entry.kind === "model"), kind.value === "harness");
    if (kind.value !== "harness") initialDefinition = definitionFingerprint();
  };

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
    const dirty = (priorSelection.get(kind) ?? kind.value) === "harness" ? harnessEditor.dirty()
      : !find("definition-content").disabled && initialDefinition !== definitionFingerprint();
    if (dirty && !window.confirm("저장하지 않은 변경 사항을 지우시겠습니까?")) {
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
    showFields(selected?.payload ?? defaultPayload());
    resetTools();
    rememberSelection();
    if (!find("harness-uses").hidden && find("harness-uses").open) void refreshUses();
  }

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
    showFields(historical.payload);
    resetTools();
    rememberSelection();
    if (find("harness-uses").open) void refreshUses();
    const diff = find("definition-diff");
    diff.hidden = current === previous;
    if (!diff.hidden) diff.textContent = `현재 버전 ${selected.version}\n${current}\n\n선택한 버전 ${historical.version}\n${previous}`;
  });
  find("definition-version").addEventListener("change", selectVersion);
  form.addEventListener("submit", report(async () => {
    const old = entries().find((entry) => entry.id === definition.value);
    let payload;
    if (kind.value === "harness") payload = harnessEditor.payload();
    else if (kind.value === "loop") payload = loopFields.payload();
    else {
      const [provider, model] = JSON.parse(controls.catalogModel.value);
      payload = { name: controls.modelName.value, provider, model, reasoning: controls.reasoning.value };
    }
    const { scope, project: projectId, team } = owner();
    const saved = await request("definitions", {}, { scope, project: projectId, team,
      kind: kind.value, payload, id: old?.id, version: old?.version });
    await refreshDefinitions(saved.id, true);
    find("status").textContent = `${saved.name} · v${saved.version} 저장됨`;
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
      const labels = { harness: "새 하네스", model: "새 모델", loop: "새 루프" };
      options(definition, entries().filter((entry) => entry.kind === kind.value), labels[kind.value], chosen);
      showDefinition();
    },
  };
}
