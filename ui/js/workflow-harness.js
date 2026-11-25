export function bindWorkflowHarness({ el, form, definitions, choices, editHarness }) {
  const fields = el("agent-profile");
  const selector = form.elements.harnessDefinition;
  const versions = form.elements.harnessVersion;
  const instruction = form.elements.harnessInstruction;
  const edit = el("harness-edit");
  const linked = el("linked-profile");
  const definitionControls = [selector, versions, edit];
  let profileNode;

  function fillVersions(id, chosen) {
    const record = definitions().find((entry) => entry.id === id && entry.kind === "harness");
    versions.replaceChildren();
    for (let version = record?.version ?? 0; version > 0; version--) {
      versions.add(new Option("v" + version, String(version)));
    }
    if (chosen) versions.value = String(chosen);
    edit.disabled = !selector.value || !versions.value;
  }

  function refreshChoices(chosen = selector.value) {
    if (fields.disabled) return;
    choices(selector, [["", "하네스 선택"], ...definitions().filter(({ kind }) => kind === "harness")
      .map((entry) => [entry.id, engineeringDefinitionLabel(entry)])]);
    selector.value = chosen;
    if (selector.selectedIndex < 0) selector.value = "";
  }

  selector.addEventListener("change", () => fillVersions(selector.value));
  edit.addEventListener("click", () => editHarness(selector.value, Number(versions.value)));
  return {
    refreshChoices,
    show(node, profile) {
      const visible = node?.type === "agent";
      fields.hidden = fields.disabled = !visible;
      if (!visible) return;
      profileNode = profile;
      linked.hidden = !profile;
      linked.textContent = profile ? `연결된 프로필 · ${profile.label} · v${profile.profileVersion}` : "";
      for (const control of definitionControls) {
        control.disabled = Boolean(profile);
        (control.closest("label") ?? control).hidden = Boolean(profile);
      }
      refreshChoices(node.definition || "");
      fillVersions(selector.value, node.version);
      instruction.value = node.instruction ?? "";
    },
    apply(settings) {
      if (fields.disabled) return settings;
      if (profileNode) {
        const { definition, version, ...rest } = settings;
        return { ...rest, instruction: instruction.value };
      }
      if (!selector.value || !versions.value) throw new Error("하네스와 버전을 선택해 주세요.");
      return { ...settings, definition: selector.value, version: Number(versions.value), instruction: instruction.value };
    },
  };
}
