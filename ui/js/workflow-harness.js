export function bindWorkflowHarness({ el, form, definitions, choices, editHarness }) {
  const fields = el("agent-profile");
  const selector = form.elements.harnessDefinition;
  const versions = form.elements.harnessVersion;
  const instruction = form.elements.harnessInstruction;
  const edit = el("harness-edit");

  function fillVersions(id, chosen) {
    const record = definitions().find((entry) => entry.id === id && entry.kind === "harness");
    versions.replaceChildren();
    for (let version = record?.version ?? 0; version > 0; version--) {
      versions.add(new Option("v" + version, String(version)));
    }
    if (chosen) versions.value = String(chosen);
    edit.disabled = !selector.value || !versions.value;
  }

  selector.addEventListener("change", () => fillVersions(selector.value));
  edit.addEventListener("click", () => editHarness(selector.value, Number(versions.value)));
  return {
    show(node) {
      const visible = node?.type === "agent";
      fields.hidden = fields.disabled = !visible;
      if (!visible) return;
      choices(selector, [["", "하네스 선택"],
        ...definitions().filter(({ kind }) => kind === "harness").map(({ id, name }) => [id, name])]);
      selector.value = node.definition || "";
      fillVersions(selector.value, node.version);
      instruction.value = node.instruction ?? "";
    },
    apply(settings) {
      if (fields.disabled) return settings;
      if (!selector.value || !versions.value) throw new Error("하네스와 버전을 선택해 주세요.");
      return { ...settings, definition: selector.value, version: Number(versions.value), instruction: instruction.value };
    },
  };
}
