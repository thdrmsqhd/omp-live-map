const wfEditTypes = {
  agent: "에이전트", loop: "작업·검증 반복", command: "검증 명령", condition: "조건",
  approval: "승인", parallel: "병렬 시작", join: "병렬 합류", subgraph: "하위 Workflow",
};
const wfEditPorts = { condition: ["true", "false"], approval: ["approved", "rejected"] };
const wfOption = (value, label) => new Option(label, value);
const wfApplyLabel = "노드 적용";

function wfField(parent, label, key, node) {
  node.name = key;
  const wrapper = wfText("label", label);
  wrapper.append(node);
  parent.append(wrapper);
  return node;
}

function wfInput(value, area = false) {
  const node = document.createElement(area ? "textarea" : "input");
  node.value = value ?? "";
  if (area) node.rows = 3;
  return node;
}

function wfSelect(items, chosen) {
  const selector = document.createElement("select");
  selector.append(...items);
  if (chosen !== undefined) selector.value = chosen;
  return selector;
}

function wfContractRows(node, form, draft) {
  const section = document.createElement("details");
  section.append(wfText("summary", "입력·산출물"));
  function rows(title, kind, entries, render) {
    const list = document.createElement("div");
    const insert = (entry) => {
      const row = document.createElement("div");
      row.dataset.contract = kind;
      render(row, entry);
      row.append(wfActionButton("삭제", () => { row.remove(); form.dispatchEvent(new Event("input")); }));
      list.append(row);
    };
    section.append(wfText("h4", title), list, wfActionButton(title + " 추가", () => {
      insert({});
      form.dispatchEvent(new Event("input"));
    }));
    entries.forEach(insert);
  }
  rows("입력", "input", node.inputs ?? [], (row, entry) => {
    wfField(row, "입력 이름", "contractName", wfInput(entry.name));
    const predecessors = draft.payload.nodes.filter(({ id, outputs }) => id !== node.id && outputs?.length);
    const source = wfField(row, "출처 노드", "contractSource", wfSelect(
      [wfOption("", "선택"), ...predecessors.map((source) => wfOption(source.id, source.label))], entry.source ?? ""));
    const artifact = wfField(row, "출처 산출물", "contractArtifact", wfSelect([]));
    const fill = () => artifact.replaceChildren(...(predecessors.find(({ id }) => id === source.value)?.outputs ?? [])
      .map(({ name }) => wfOption(name, name)));
    source.addEventListener("change", fill);
    fill();
    if (entry.artifact) artifact.value = entry.artifact;
  });
  rows("산출물", "output", node.outputs ?? [], (row, entry) => {
    wfField(row, "산출물 이름", "contractName", wfInput(entry.name));
    wfField(row, "파일 경로", "contractPath", wfInput(entry.path));
  });
  form.append(section);
}

async function wfStepForm(node, draft, commit) {
  const form = document.createElement("form");
  form.append(wfText("h3", node.label));
  wfField(form, "단계 이름", "label", wfInput(node.label));
  let picked;
  if (["agent", "loop", "subgraph"].includes(node.type)) {
    const targetKey = node.type === "subgraph" ? "workflow" : "definition";
    const entries = node.type === "subgraph" ? draft.workflows.filter(({ id }) => id !== draft.record.id)
      : draft.definitions.filter(({ kind }) => kind === (node.type === "agent" ? "harness" : "loop"));
    const selector = wfField(form, node.type === "agent" ? "하네스" : node.type === "loop" ? "Loop 프로필" : "하위 Workflow",
      targetKey, wfSelect([wfOption("", "선택"), ...entries.map(({ id, name }) => wfOption(id, name))], node[targetKey] ?? ""));
    const version = wfField(form, "버전", "version", wfSelect([]));
    const limit = node.type === "loop" ? wfField(form, "최대 시도 횟수 (1~8)", "attempts", wfInput()) : null;
    if (limit) Object.assign(limit, { type: "number", min: 1, max: 8 });
    const harness = node.type === "agent" ? document.createElement("a") : null;
    if (harness) {
      harness.textContent = "선택한 하네스 설정 열기";
      harness.addEventListener("click", (event) => {
        if (!wfAllowLeave()) event.preventDefault();
      });
      form.append(harness);
    }
    const sync = async () => {
      const id = selector.value, chosenVersion = Number(version.value);
      picked = null;
      if (harness) {
        harness.hidden = !id || !chosenVersion;
        harness.href = "/engineering.html?" + new URLSearchParams({ project: draft.record.project, view: "design", harness: id, version: chosenVersion });
      }
      if (!id || !chosenVersion || node.type === "subgraph") return;
      const entry = entries.find((item) => item.id === id);
      const record = chosenVersion === entry.version ? entry : await mapWorkflowRequest("definitions/version", { id, version: chosenVersion });
      if (id !== selector.value || chosenVersion !== Number(version.value)) return;
      picked = record;
      if (limit) limit.value = (id === node.definition && chosenVersion === node.version ? draft.loops[node.id] : undefined) ?? record.payload.attempts;
    };
    const fill = () => {
      const latest = entries.find(({ id }) => id === selector.value)?.version ?? 0;
      version.replaceChildren(...Array.from({ length: latest }, (_, index) => wfOption(String(latest - index), "v" + (latest - index))));
    };
    const syncReported = () => void sync().catch(wfEditReport);
    fill();
    if (node.version) version.value = String(node.version);
    await sync();
    selector.onchange = () => { fill(); syncReported(); };
    version.onchange = syncReported;
  }
  if (["agent", "loop"].includes(node.type)) wfField(form, "작업 지시", "instruction", wfInput(node.instruction, true));
  if (node.type === "command") {
    wfField(form, "검증 명령", "command", wfInput(node.check?.command));
    wfField(form, "명령 인수 (줄마다 하나)", "args", wfInput(node.check?.args?.join("\n"), true));
    wfField(form, "기대 종료 코드", "code", wfInput(node.check?.code ?? 0));
  }
  if (node.type === "approval") wfField(form, "검토 요청 문구", "prompt", wfInput(node.prompt, true));
  if (node.type === "condition") {
    wfField(form, "판단할 단계", "source", wfSelect(
      draft.payload.nodes.filter(({ type }) => ["agent", "command", "loop"].includes(type))
        .map(({ id, label }) => wfOption(id, label)), node.source));
    const field = wfField(form, "조건", "field", wfSelect([wfOption("passed", "검증 통과 여부"), wfOption("status", "실행 상태")], node.field ?? "passed"));
    const equals = wfField(form, "일치할 값", "equals", wfSelect([]));
    const fill = () => equals.replaceChildren(...(field.value === "passed" ? [["true", "통과"], ["false", "실패"]] :
      [["succeeded", "완료"], ["failed", "실패"], ["skipped", "건너뜀"]]).map(([value, label]) => wfOption(value, label)));
    field.onchange = fill;
    fill();
    if (node.equals !== undefined) equals.value = String(node.equals);
  }
  wfContractRows(node, form, draft);
  const apply = wfText("button", wfApplyLabel);
  apply.type = "submit";
  form.append(apply);
  form.addEventListener("input", () => { draft.fieldsDirty = true; });
  form.onsubmit = (event) => {
    event.preventDefault();
    try {
      const data = new FormData(form);
      const next = { ...node, label: data.get("label").trim() };
      for (const key of ["definition", "workflow", "instruction", "prompt", "field", "source"]) if (data.has(key)) next[key] = data.get(key);
      if (data.get("version")) next.version = Number(data.get("version"));
      if (data.has("command")) next.check = { command: data.get("command"), args: data.get("args").split(/\r?\n/).filter(Boolean), code: Number(data.get("code")) };
      if (data.has("equals")) next.equals = next.field === "passed" ? data.get("equals") === "true" : data.get("equals");
      const contract = (kind, keys) => [...form.querySelectorAll('[data-contract="' + kind + '"]')].map((row) =>
        Object.fromEntries(keys.map((key) => [key, row.querySelector('[name="contract' + key[0].toUpperCase() + key.slice(1) + '"]').value.trim()])));
      next.inputs = contract("input", ["name", "source", "artifact"]);
      next.outputs = contract("output", ["name", "path"]);
      const result = picked?.payload.result;
      if (result && !next.outputs.some(({ path }) => path === result.path)) {
        const names = new Set(next.outputs.map(({ name }) => name));
        let name = "harness_result";
        while (names.has(name)) name += "_";
        next.outputs.push({ name, path: result.path });
      }
      if (data.has("attempts") && !picked) throw new Error("Loop 버전 정보를 불러온 뒤 적용해 주세요.");
      commit(next, data.has("attempts") ? Number(data.get("attempts")) : undefined);
    } catch (error) { wfEditReport(error); }
  };
  return form;
}
