const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const templates = {
  developer: ["개발자", "요구사항에 맞춰 코드를 변경하고 관련 테스트를 수행한 뒤 수정 사항과 검증 결과를 요약합니다."],
  reviewer: ["코드 리뷰어", "변경 사항의 회귀 가능성을 검토합니다. 각 발견 사항에 파일, 줄 번호, 근거, 재현 조건을 기록합니다."],
  writer: ["문서 작성자", "프로젝트 코드와 문서를 바탕으로 사용 절차와 제약을 정리합니다."],
  custom: ["", ""],
};

export function bindHarnessEditor({ find, options, newProfile }) {
  const fields = find("harness-fields");
  const form = fields.form;
  const skills = find("harness-skills");
  const add = find("harness-add-skill");
  const draft = find("harness-draft");
  let original = {};
  let initial = "";
  let models = [];
  let pendingCopy = false;

  const get = (key) => form.elements.namedItem(key);
  const values = () => new FormData(form);
  const fingerprint = () => JSON.stringify([...values()].filter(([key]) => key !== "payload"));
  const dirty = () => !fields.disabled && initial !== fingerprint();

  function changed() {
    draft.textContent = dirty() || pendingCopy ? "저장할 변경 사항이 있습니다." : "";
    add.disabled = skills.children.length >= 5;
  }

  function addSkill({ name = "", markdown = "" } = {}) {
    if (skills.children.length >= 5) return;
    const item = document.createElement("fieldset");
    const title = document.createElement("label");
    const input = document.createElement("input");
    input.name = "skillName";
    input.pattern = "[a-z0-9][a-z0-9\\-]{0,63}";
    input.required = true;
    input.maxLength = 64;
    input.value = name;
    title.append("스킬 이름", input);
    const description = document.createElement("label");
    const instructions = document.createElement("textarea");
    instructions.name = "skillMarkdown";
    instructions.rows = 3;
    instructions.maxLength = 4000;
    instructions.value = markdown;
    description.append("지시", instructions);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "이 스킬 삭제";
    remove.addEventListener("click", () => { item.remove(); changed(); });
    item.append(title, description, remove);
    skills.append(item);
    changed();
  }

  function jsonDraft(field, label) {
    try {
      const value = JSON.parse(get(field).value || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      get(field).closest("details").open = true;
      get(field).focus();
      throw new Error(label + " 설정은 JSON 객체로 입력해 주세요.");
    }
  }

  function payload() {
    const data = values();
    const markdown = data.getAll("skillMarkdown");
    const shape = data.get("resultShape");
    const value = { ...original };
    delete value.result;
    if (shape) value.result = { shape, path: data.get("resultPath"), fields: lines(data.get("resultFields")) };
    return {
      ...value,
      name: data.get("harnessName"),
      adapter: data.get("adapter"),
      model: data.get("harnessModel"),
      role: data.get("role"),
      instructions: data.get("instructions"),
      assets: {
        ...original.assets,
        agents: data.get("agents"),
        files: lines(data.get("sourceFiles")),
        inputs: lines(data.get("sourceInputs")),
        skills: data.getAll("skillName").map((name, index) => ({ name, markdown: markdown[index] })),
        mcp: jsonDraft("mcp", "MCP"),
        hooks: jsonDraft("hooks", "Hooks"),
      },
    };
  }

  function show(value, availableModels, visible, copy = false) {
    fields.hidden = fields.disabled = !visible;
    find("definition-json").hidden = visible;
    get("payload").disabled = visible;
    if (!visible) return;
    models = availableModels;
    original = value;
    pendingCopy = copy;
    draft.textContent = "";
    get("harnessName").value = value.name ?? "";
    get("role").value = value.role ?? "";
    get("adapter").value = value.adapter ?? "claude";
    get("instructions").value = value.instructions ?? "";
    get("agents").value = value.assets?.agents ?? "";
    get("sourceFiles").value = value.assets?.files?.join("\n") ?? "";
    get("sourceInputs").value = value.assets?.inputs?.join("\n") ?? "";
    get("resultShape").value = value.result?.shape ?? "";
    get("resultPath").value = value.result?.path ?? "";
    get("resultFields").value = value.result?.fields?.join("\n") ?? "";
    get("mcp").value = JSON.stringify(value.assets?.mcp ?? {}, null, 2);
    get("hooks").value = JSON.stringify(value.assets?.hooks ?? {}, null, 2);
    options(get("harnessModel"), models, "모델 선택", value.model ?? "");
    skills.replaceChildren();
    for (const skill of value.assets?.skills ?? []) addSkill(skill);
    initial = fingerprint();
    changed();
  }

  fields.addEventListener("input", changed);
  add.addEventListener("click", () => addSkill());
  find("harness-template-use").addEventListener("click", () => {
    const [role, instructions] = templates[find("harness-template").value];
    newProfile({ name: role, role, instructions, adapter: get("adapter").value, model: get("harnessModel").value }, models);
  });
  find("harness-copy").addEventListener("click", () => {
    try {
      const copy = payload();
      newProfile({ ...copy, name: (copy.name || "하네스").slice(0, 237) + " 복제" }, models, true);
    } catch (error) {
      draft.textContent = error.message;
    }
  });
  return { show, payload, revision: fingerprint, dirty: () => !fields.disabled && (dirty() || pendingCopy) };
}
