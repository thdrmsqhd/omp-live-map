import { bindHarnessTrials } from "./harness-trials.js";
import { bindHarnessPreview } from "./harness-preview.js";
import { bindHarnessEditor } from "./harness-editor.js";

export function bindDefinitionEditor({ find, request, report, options, definitions: entries, refreshDefinitions }) {
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
    project: () => project.value, saved: () => definition.value ? {
      id: definition.value, version: Number(find("definition-version").value),
    } : null,
  });
  const trial = bindHarnessTrials({ find, request, options, payload: harnessEditor.payload,
    project: () => project.value, entries: () => entries().filter(({ kind }) => kind === "harness"),
    selected: () => definition.value,
  });
  const selection = [project, kind, definition, find("definition-version")];
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

  function showDefinition() {
    const selected = entries().find((entry) => entry.id === definition.value);
    find("payload").value = JSON.stringify(selected?.payload ?? defaultPayload(), null, 2);
    find("remove").disabled = !selected;
    find("definition-diff").hidden = true;
    find("harness-uses").hidden = kind.value !== "harness" || !selected;
    const versions = find("definition-version");
    versions.replaceChildren();
    for (let version = selected?.version ?? 0; version > 0; version--) versions.add(new Option(String(version), String(version)));
    versions.disabled = !selected;
    harnessEditor.show(selected?.payload ?? defaultPayload(), entries().filter((entry) => entry.kind === "model"), kind.value === "harness");
    preview.reset();
    trial.update();
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
    preview.reset();
    trial.update();
    rememberSelection();
    const diff = find("definition-diff");
    diff.hidden = current === previous;
    if (!diff.hidden) diff.textContent = `현재 버전 ${selected.version}\n${current}\n\n선택한 버전 ${historical.version}\n${previous}`;
  });
  find("definition-version").addEventListener("change", selectVersion);
  find("definition-form").addEventListener("submit", report(async (event) => {
    const old = entries().find((entry) => entry.id === definition.value);
    const payload = kind.value === "harness" ? harnessEditor.payload() : JSON.parse(new FormData(event.currentTarget).get("payload"));
    const saved = await request("definitions", {}, { project: project.value, kind: kind.value, payload, id: old?.id, version: old?.version });
    await refreshDefinitions(saved.id);
  }));
  find("remove").addEventListener("click", report(async () => {
    if (!mayReplace()) return;
    await request("definitions/remove", {}, { id: definition.value });
    await refreshDefinitions("");
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
      options(definition, entries().filter((entry) => entry.kind === kind.value), "새 정의", chosen);
      showDefinition();
    },
  };
}
