const labels = { baseline: "기준 버전", draft: "수정 초안", running: "실행 중", finished: "실행 종료",
  queued: "대기", succeeded: "성공", failed: "실패", cancelled: "취소", timed_out: "시간 초과",
  role: "역할", instructions: "작업 지시", adapter: "실행기", model: "모델", rules: "프로젝트 규칙",
  skills: "스킬", files: "저장소 파일", inputs: "Workflow 입력", result: "결과 형식",
};

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

export function bindHarnessTrials({ find, request, options, payload, project, entries, selected }) {
  const baseline = find("trial-baseline");
  const version = find("trial-version");
  const status = find("trial-status");
  const start = find("trial-start");
  const cancel = find("trial-cancel");
  const results = find("trial-results");
  const editor = find("harness-trial");
  const materialFields = find("trial-materials");
  let owner = "";
  let record = null;
  let timer;
  let pending = false;
  let materialRevision = 0;
  let startRequest;

  function selectedRecord() {
    return entries().find(({ id }) => id === baseline.value);
  }

  function controls() {
    start.disabled = !project() || pending || record?.status === "running" || !version.value;
    cancel.hidden = record?.status !== "running";
    cancel.disabled = pending;
  }

  function updateVersions(chosen) {
    const previous = version.value;
    version.replaceChildren();
    for (let number = selectedRecord()?.version ?? 0; number > 0; number--) {
      version.add(new Option("v" + number, String(number)));
    }
    if ([...version.options].some((option) => option.value === previous) && chosen) version.value = previous;
    controls();
  }

  async function updateMaterials() {
    const revision = ++materialRevision;
    const draftNames = find("harness-fields").querySelector('[name="sourceInputs"]').value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    const historic = version.value ? await request("definitions/version", { id: baseline.value, version: version.value }) : null;
    if (revision !== materialRevision) return;
    const names = new Set([...(historic?.payload.assets?.inputs ?? []), ...draftNames]);
    const existing = new Map([...materialFields.querySelectorAll("textarea")].map((field) => [field.dataset.input, field.value]));
    materialFields.replaceChildren(...[...names].map((name) => {
      const field = document.createElement("textarea");
      field.dataset.input = name;
      field.rows = 3;
      field.maxLength = 16384;
      field.value = existing.get(name) ?? "";
      const label = element("label", name + " 입력 자료");
      label.append(field);
      return label;
    }));
  }

  function update() {
    if (owner !== project()) {
      owner = project();
      startRequest = null;
      record = null;
      clearTimeout(timer);
      results.hidden = true;
      find("trial-changes").hidden = true;
      status.textContent = "";
      find("trial-instruction").value = "";
      materialFields.replaceChildren();
    }
    const previous = baseline.value;
    options(baseline, entries(), "저장된 프로필 선택", baseline.value || selected());
    updateVersions(previous === baseline.value);
    if (editor.open) void updateMaterials().catch((error) => { status.textContent = error.message; });
  }

  function render(data) {
    record = data;
    const input = "커밋 " + data.commit.slice(0, 12) + " · 입력 SHA-256 " + data.inputHash;
    status.textContent = (labels[data.status] ?? data.status) + " · " + input + (data.modelChanged ? " · 비교 모델이 서로 다릅니다." : "");
    controls();
    results.hidden = false;
    results.replaceChildren(...["baseline", "draft"].map((side) => {
      const result = data.results[side] ?? {};
      const profile = data.profiles[side];
      const panel = document.createElement("article");
      panel.append(element("h3", labels[side]), element("p", profile.name + (profile.version ? " v" + profile.version : "")),
        element("p", profile.adapter + " · " + profile.model.name + " v" + profile.model.version),
        element("p", labels[result.status] ?? "대기"));
      if (result.elapsedMs !== undefined) panel.append(element("p", (result.elapsedMs / 1000).toFixed(2) + "초"));
      if (result.costCents !== undefined) panel.append(element("p", result.costCents.toFixed(2) + "센트" +
        (result.costBasis === "reserved" ? " (예약 기준)" : "")));
      if (result.error) panel.append(element("p", result.error));
      if (result.validation) {
        panel.append(element("p", result.validation.passed ? "결과 형식 검사 통과" : "결과 형식 검사 실패"),
          ...result.validation.errors.map((error) => element("p", error)));
        if (result.validation.output) panel.append(element("pre", result.validation.output));
      }
      if (result.status === "succeeded" || result.status === "failed") {
        const tools = result.tools === null || result.tools === undefined ? "미수집" :
          result.tools.length ? result.tools.join(", ") : "호출 기록 없음";
        panel.append(element("p", "도구 기록 · " + tools));
        if (result.output) panel.append(element("pre", result.output));
      }
      if (result.workspace) panel.append(element("p", "변경 내용이 남아 있는 작업 폴더 · " + result.workspace));
      if (data.status !== "running" && ["failed", "cancelled", "timed_out"].includes(result.status)) {
        const retry = element("button", labels[side] + "만 재시도");
        retry.type = "button";
        retry.addEventListener("click", () => action("retry", side));
        panel.append(retry);
      }
      return panel;
    }));
    const changes = find("trial-changes");
    changes.hidden = !data.changes.length;
    changes.querySelector("dl").replaceChildren(...data.changes.flatMap(({ key, before, after }) => [
      element("dt", labels[key] ?? key),
      element("dd", "기준: " + JSON.stringify(before)),
      element("dd", "초안: " + JSON.stringify(after)),
    ]));
  }

  function display(data, value) {
    if (value !== project()) return;
    render(data);
    clearTimeout(timer);
    if (data.status === "running") timer = setTimeout(async () => {
      try {
        const current = await request("harness/trial", { id: data.id, project: value });
        display(current, value);
      } catch (error) {
        if (value === project()) status.textContent = error.message;
      }
    }, 500);
  }

  async function action(operation, side) {
    if (pending) return;
    const value = project();
    pending = true;
    controls();
    try {
      const data = await request("harness/trial/" + operation, {}, { id: record.id, project: value, side });
      display(data, value);
    } catch (error) {
      if (project() === value) status.textContent = error.message;
    } finally {
      pending = false;
      controls();
    }
  }

  async function begin() {
    if (pending || !version.value) return;
    const value = project();
    pending = true;
    controls();
    try {
      await updateMaterials();
      if (project() !== value) return;
      const body = { project: value, baseline: { id: baseline.value, version: Number(version.value) }, payload: payload(),
        instruction: find("trial-instruction").value, materials: Object.fromEntries(
          [...materialFields.querySelectorAll("textarea")].map((field) => [field.dataset.input, field.value])),
        budgetCents: Number(find("trial-budget").value), timeoutMs: Number(find("trial-minutes").value) * 60000 };
      const signature = JSON.stringify(body);
      if (startRequest?.signature !== signature) startRequest = { signature, key: crypto.randomUUID() };
      const data = await request("harness/trial", {}, { ...body, key: startRequest.key });
      startRequest = null;
      display(data, value);
    } catch (error) {
      if (project() === value) status.textContent = error.message;
    } finally {
      pending = false;
      controls();
    }
  }

  const populate = () => void updateMaterials().catch((error) => { status.textContent = error.message; });
  editor.addEventListener("toggle", () => { if (editor.open) populate(); });
  baseline.addEventListener("change", () => { updateVersions(false); populate(); });
  version.addEventListener("change", populate);
  find("harness-fields").querySelector('[name="sourceInputs"]').addEventListener("change", populate);
  start.addEventListener("click", begin);
  cancel.addEventListener("click", () => action("cancel"));
  return { update };
}
