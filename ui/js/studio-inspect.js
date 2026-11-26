// 노드 캔버스의 정의 상세 패널. 폼 화면에만 있던 기능을 노드에서 바로 쓴다.
// - 버전 기록: 저장된 버전을 골라 내용을 보고, 그 버전을 초안으로 불러온다(저장하면 새 버전이 된다).
// - 하네스: 실제 적용값(harness/preview), 사용 중인 Workflow 와 새 버전 적용(harness/uses·apply), 같은 입력 비교 실행(harness/trial).
const SECTION_NAMES = { role: "역할", instructions: "작업 지시", assets: "프로젝트 규칙과 스킬", result: "결과 형식" };
const TRIAL_LABELS = { baseline: "기준 버전", draft: "수정 초안", running: "실행 중", finished: "실행 종료",
  queued: "대기", succeeded: "성공", failed: "실패", cancelled: "취소", timed_out: "시간 초과",
  role: "역할", instructions: "작업 지시", adapter: "실행기", model: "모델", rules: "프로젝트 규칙",
  skills: "스킬", files: "저장소 파일", inputs: "Workflow 입력", result: "결과 형식" };
const KIND_NAMES = { model: "모델", harness: "하네스", loop: "루프", profile: "에이전트 프로필" };

export function bindStudioInspect({ root, h, request, project, payloadOf, loadVersion, say }) {
  let node = null, revision = 0, trialTimer = 0, trialRecord = null, trialKey = null;
  const text = (tag, value, props = {}) => h(tag, props, value ?? "");
  const busy = (button, work) => async () => {
    button.disabled = true;
    try { await work(); } catch (error) { say(error.message, "error"); } finally { button.disabled = false; }
  };

  function close() {
    node = null;
    revision++;
    clearTimeout(trialTimer);
    root.hidden = true;
    root.replaceChildren();
  }

  // ---- 버전 기록 -------------------------------------------------------------
  function versions(current) {
    const record = current.record;
    if (!record || current.kind === "profile") return null;
    const picker = h("select", { "aria-label": "버전" }, ...Array.from({ length: record.version }, (_, index) => {
      const number = record.version - index;
      return h("option", { value: String(number) }, "v" + number + (number === record.version ? " (최신)" : ""));
    }));
    const body = text("pre", "", { class: "studio-inspect-pre" });
    const load = h("button", { type: "button", class: "studio-mini" }, "이 버전을 초안으로 불러오기");
    let shown = null;
    async function show() {
      const mine = revision, number = Number(picker.value);
      body.textContent = "불러오는 중입니다.";
      const version = number === record.version ? record : await request("definitions/version", { id: record.id, version: number });
      if (mine !== revision) return;
      shown = version;
      body.textContent = JSON.stringify(version.payload, null, 2);
      load.disabled = number === record.version && JSON.stringify(current.draft) === JSON.stringify(version.payload);
    }
    picker.addEventListener("change", () => void show().catch((error) => { body.textContent = error.message; }));
    load.addEventListener("click", () => {
      if (!shown) return;
      loadVersion(current, structuredClone(shown.payload), shown.version);
      say(`v${shown.version} 내용을 초안으로 불러왔습니다. '새 버전 저장'을 누르면 v${record.version + 1}로 저장됩니다.`, "ok");
    });
    void show().catch((error) => { body.textContent = error.message; });
    return h("details", { open: true }, h("summary", {}, "버전 기록 · 최신 v" + record.version), h("div", { class: "studio-inspect-row" }, picker, load), body);
  }

  // ---- 하네스: 실제 적용값 -----------------------------------------------------
  function preview(current) {
    const out = h("div", { class: "studio-inspect-preview" });
    const status = text("p", "", { role: "status", class: "studio-inspect-status" });
    async function run(saved) {
      const mine = revision;
      status.textContent = "적용값을 확인하는 중입니다.";
      out.replaceChildren();
      const query = saved ? { id: current.record.id, version: current.record.version } : { payload: payloadOf(current) };
      const result = await request("harness/preview", {}, { ...query, project: project() });
      if (mine !== revision) return;
      const { profile, model, prompt, policy, ready, blockedReason, sources, workflowInputs } = result;
      const settings = [
        ["대상", profile.version ? profile.name + " v" + profile.version : profile.name + " · 초안"],
        ["실행기", profile.adapter === "claude" ? "Claude Code" : "OMP"],
        ["모델", model.name + " v" + model.version + " · " + model.provider + "/" + model.id],
      ];
      if (model.reasoning) settings.push(["추론 수준", model.reasoning]);
      if (policy) {
        settings.push(["작업 폴더", "관리되는 Git worktree (" + policy.directory + ")"]);
        settings.push(["런타임에서 강제하는 범위", "작업 폴더 내 쓰기 허용 · 네트워크 격리"]);
        settings.push(["사용 도구", policy.tools.join(", ")]);
      }
      for (const source of sources) settings.push(["저장소 자료", source.path + " · " + source.commit.slice(0, 12) + " · SHA-256 " + source.sha256]);
      if (workflowInputs.length) settings.push(["Workflow에서 연결할 입력", workflowInputs.join(", ")]);
      settings.push(["MCP·Hooks", "초안 저장 · 실행 미지원"]);
      out.replaceChildren(h("dl", {}, ...settings.flatMap(([label, value]) => [text("dt", label), text("dd", value)])),
        text("h4", "프롬프트로 전달되는 순서"),
        h("ol", {}, ...prompt.map(({ name, path, text: body }) => h("li", {}, path ?? SECTION_NAMES[name] ?? name, text("pre", body)))));
      status.textContent = ready ? "실행 준비 완료" : "현재 실행할 수 없습니다. " + blockedReason;
    }
    const draft = h("button", { type: "button", class: "studio-mini" }, "편집 중 초안");
    const saved = h("button", { type: "button", class: "studio-mini", disabled: !current.record }, current.record ? "저장 버전 v" + current.record.version : "저장 버전 없음");
    draft.onclick = busy(draft, () => run(false));
    saved.onclick = busy(saved, () => run(true));
    if (!project()) status.textContent = "작업 프로젝트를 고르면 실제 적용값을 볼 수 있습니다.";
    draft.disabled = !project();
    if (!project()) saved.disabled = true;
    return h("details", {}, h("summary", {}, "실제 적용값"), h("div", { class: "studio-inspect-row" }, draft, saved), status, out);
  }

  // ---- 하네스: 사용 중인 Workflow ----------------------------------------------
  function uses(current) {
    const list = h("ul", { class: "studio-inspect-list" });
    const box = h("details", {}, h("summary", {}, "사용 중인 Workflow"), list);
    async function refresh() {
      const mine = revision, owner = project(), id = current.record.id, target = current.record.version;
      list.replaceChildren(text("li", "불러오는 중입니다."));
      const rows = await request("harness/uses", { project: owner, id });
      if (mine !== revision) return;
      list.replaceChildren(...(rows.length ? rows : [null]).map((row) => {
        if (!row) return text("li", "이 프로젝트에서 연결된 Workflow가 없습니다.");
        const item = text("li", row.name + " v" + row.version + " · 단계 " + row.node + " · " +
          (row.loop ? row.loopName + " v" + row.loopVersion + " → " : "") + "하네스 v" + row.harnessVersion);
        if (row.harnessVersion !== target) {
          const apply = h("button", { type: "button", class: "studio-mini" }, "v" + target + " 적용");
          apply.onclick = busy(apply, async () => {
            const loop = row.loop ? " 연결된 루프의 새 버전도 함께 저장합니다." : "";
            if (!window.confirm(row.name + " v" + row.version + "의 " + row.node + " 단계에서 하네스 v" + row.harnessVersion + " → v" + target +
              "을 적용하고 새 Workflow 버전을 저장할까요?" + loop)) return;
            const result = await request("harness/apply", {}, { project: owner, workflow: row.workflow, version: row.version, node: row.node,
              harness: id, harnessVersion: target });
            say("Workflow v" + result.workflow.version + " 저장됨" + (result.loop ? " · 루프 v" + result.loop.version + " 저장됨" : ""), "ok");
            await refresh();
          });
          item.append(" ", apply);
        }
        return item;
      }));
    }
    box.addEventListener("toggle", () => { if (box.open) void refresh().catch((error) => list.replaceChildren(text("li", error.message))); });
    return project() && current.record ? box : null;
  }

  // ---- 하네스: 같은 입력으로 비교 실행 -----------------------------------------
  function trial(current) {
    if (!project() || !current.record) return null;
    const record = current.record;
    const version = h("select", { "aria-label": "기준 버전" }, ...Array.from({ length: record.version }, (_, index) =>
      h("option", { value: String(record.version - index) }, "v" + (record.version - index))));
    const instruction = h("textarea", { rows: 4, maxLength: 12000, placeholder: "두 설정에 똑같이 전달할 작업 지시" });
    const materials = h("div", {});
    const budget = h("input", { type: "number", min: 1, max: 100000, value: 100, class: "studio-narrow" });
    const minutes = h("input", { type: "number", min: 1, max: 20, value: 5, class: "studio-narrow" });
    const start = h("button", { type: "button", class: "studio-mini" }, "기준 버전과 초안 실행");
    const cancel = h("button", { type: "button", class: "studio-mini", hidden: true }, "비교 취소");
    const status = text("p", "", { role: "status", class: "studio-inspect-status" });
    const results = h("div", { class: "studio-inspect-trial" });
    async function fillMaterials() {
      const historic = await request("definitions/version", { id: record.id, version: version.value });
      const names = new Set([...(historic.payload.assets?.inputs ?? []), ...(current.draft.assets?.inputs ?? [])]);
      const previous = new Map([...materials.querySelectorAll("textarea")].map((field) => [field.dataset.input, field.value]));
      materials.replaceChildren(...[...names].map((name) => {
        const field = h("textarea", { rows: 3, maxLength: 16384, value: previous.get(name) ?? "" });
        field.dataset.input = name;
        return h("label", { class: "studio-field" }, name + " 입력 자료", field);
      }));
    }
    function render(data) {
      trialRecord = data;
      status.textContent = (TRIAL_LABELS[data.status] ?? data.status) + " · 커밋 " + data.commit.slice(0, 12) + " · 입력 SHA-256 " + data.inputHash +
        (data.modelChanged ? " · 비교 모델이 서로 다릅니다." : "");
      cancel.hidden = data.status !== "running";
      start.disabled = data.status === "running";
      results.replaceChildren(...["baseline", "draft"].map((side) => {
        const result = data.results[side] ?? {}, profile = data.profiles[side];
        const panel = h("article", {}, text("h4", TRIAL_LABELS[side]), text("p", profile.name + (profile.version ? " v" + profile.version : "")),
          text("p", profile.adapter + " · " + profile.model.name + " v" + profile.model.version), text("p", TRIAL_LABELS[result.status] ?? "대기"));
        if (result.elapsedMs !== undefined) panel.append(text("p", (result.elapsedMs / 1000).toFixed(2) + "초"));
        if (result.costCents !== undefined) panel.append(text("p", result.costCents.toFixed(2) + "센트" + (result.costBasis === "reserved" ? " (예약 기준)" : "")));
        if (result.error) panel.append(text("p", result.error));
        if (result.validation) panel.append(text("p", result.validation.passed ? "결과 형식 검사 통과" : "결과 형식 검사 실패"),
          ...result.validation.errors.map((error) => text("p", error)));
        if (["succeeded", "failed"].includes(result.status)) {
          panel.append(text("p", "도구 기록 · " + (result.tools == null ? "미수집" : result.tools.length ? result.tools.join(", ") : "호출 기록 없음")));
          if (result.output) panel.append(text("pre", result.output));
        }
        if (data.status !== "running" && ["failed", "cancelled", "timed_out"].includes(result.status)) {
          const retry = h("button", { type: "button", class: "studio-mini" }, TRIAL_LABELS[side] + "만 재시도");
          retry.onclick = busy(retry, () => act("retry", side));
          panel.append(retry);
        }
        return panel;
      }));
      clearTimeout(trialTimer);
      const mine = revision, owner = project();
      if (data.status === "running") trialTimer = setTimeout(async () => {
        try { const next = await request("harness/trial", { id: data.id, project: owner }); if (mine === revision) render(next); }
        catch (error) { if (mine === revision) status.textContent = error.message; }
      }, 800);
    }
    async function act(operation, side) {
      render(await request("harness/trial/" + operation, {}, { id: trialRecord.id, project: project(), side }));
    }
    start.onclick = busy(start, async () => {
      await fillMaterials();
      const body = { project: project(), baseline: { id: record.id, version: Number(version.value) }, payload: payloadOf(current),
        instruction: instruction.value, materials: Object.fromEntries([...materials.querySelectorAll("textarea")].map((field) => [field.dataset.input, field.value])),
        budgetCents: Number(budget.value), timeoutMs: Number(minutes.value) * 60000 };
      const signature = JSON.stringify(body);
      if (trialKey?.signature !== signature) trialKey = { signature, key: crypto.randomUUID() };
      const data = await request("harness/trial", {}, { ...body, key: trialKey.key });
      trialKey = null;
      render(data);
    });
    cancel.onclick = busy(cancel, () => act("cancel"));
    version.addEventListener("change", () => void fillMaterials().catch((error) => { status.textContent = error.message; }));
    const box = h("details", {}, h("summary", {}, "같은 입력으로 비교 실행"),
      h("label", { class: "studio-field" }, "기준 버전", version), h("label", { class: "studio-field" }, "작업 지시", instruction), materials,
      h("div", { class: "studio-inspect-row" },
        h("label", { class: "studio-field" }, h("span", { dataset: { budget: "trial" } }, typeof engineeringBudgetLabel === "function" ? engineeringBudgetLabel("trial") : "실행별 예산(센트)"), budget),
        h("label", { class: "studio-field" }, "제한 시간(분)", minutes)),
      h("div", { class: "studio-inspect-row" }, start, cancel), status, results);
    box.addEventListener("toggle", () => { if (box.open) void fillMaterials().catch((error) => { status.textContent = error.message; }); });
    return box;
  }

  function open(target) {
    close();
    node = target;
    root.hidden = false;
    const name = target.draft?.name || KIND_NAMES[target.kind];
    root.append(h("header", { class: "studio-inspect-head" },
      h("span", {}, h("strong", {}, name), h("small", {}, KIND_NAMES[target.kind] + (target.record ? " · v" + target.record.version : " · 저장 전"))),
      h("button", { type: "button", class: "studio-mini", onclick: close, "aria-label": "상세 닫기" }, "닫기")));
    const parts = [versions(target)];
    if (target.kind === "harness") parts.push(preview(target), uses(target), trial(target));
    const shown = parts.filter(Boolean);
    root.append(...(shown.length ? shown : [text("p", target.record ? "이 노드에는 추가 상세가 없습니다." : "저장하면 버전 기록을 볼 수 있습니다.")]));
  }

  return { open, close, current: () => node };
}
