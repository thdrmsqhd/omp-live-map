// 노드 캔버스의 노드 종류: 소켓(입력·출력)과 노드 안 위젯(셀렉트·입력칸)을 만든다.
// 상태 변경과 연결은 studio.js 가 넘겨주는 ctx 로만 한다.
import { modelKey, showModelOptions } from "./engineering-model-options.js";
import "./harness-kinds.js";

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === "class") element.className = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value);
    else if (key in element && !["list", "form", "rows"].includes(key)) element[key] = value;
    else if (value !== false) element.setAttribute(key, value === true ? "" : value);
  }
  element.append(...children.flat().filter((child) => child !== undefined && child !== null && child !== false));
  return element;
}

export const KIND_LABELS = { model: "모델", harness: "하네스", loop: "루프", step: "Workflow 단계" };
export const STEP_TYPES = {
  start: "Start", end: "End", agent: "Agent", loop: "Loop 단계", command: "Command", condition: "Condition",
  parallel: "Parallel", join: "Join", approval: "Approval", subgraph: "Subgraph",
};
export const STEP_HINTS = {
  agent: "하네스로 에이전트 작업 실행", loop: "루프(재시도·검증)로 작업 실행", command: "검증 명령 한 번 실행",
  condition: "앞 단계 결과로 분기", parallel: "여러 갈래 동시 실행", join: "갈래 합치기", approval: "사람의 승인·거절",
  subgraph: "다른 Workflow 호출",
};
const PORTS = { end: [], condition: ["true", "false"], approval: ["approved", "rejected"] };
export const outputsOf = (type) => PORTS[type] ?? ["next"];
export const PORT_LABELS = { next: "다음", true: "참", false: "거짓", approved: "승인", rejected: "거절" };
export const SCOPE_LABELS = { personal: "개인", team: "팀", project: "프로젝트" };

export const HARNESS_TEMPLATES = {
  developer: ["개발자", "요구사항에 맞춰 코드를 변경하고 관련 테스트를 수행한 뒤 수정 사항과 검증 결과를 요약합니다."],
  reviewer: ["코드 리뷰어", "변경 사항의 회귀 가능성을 검토합니다. 각 발견 사항에 파일, 줄 번호, 근거, 재현 조건을 기록합니다."],
  writer: ["문서 작성자", "프로젝트 코드와 문서를 바탕으로 사용 절차와 제약을 정리합니다."],
};

export const HARNESS_CATALOG = globalThis.WORKSPACE_CATALOG;
export const harnessTypeOf = globalThis.harnessTypeOf;
export const isEvaluationRole = globalThis.isEvaluationRole;
const ROLE_SEPARATOR = " · ";
const CONTRACT_FIELDS = [["input", "입력"], ["output", "산출물"], ["criteria", "판단 기준"],
  ["handoff", "인계"], ["stop", "중단 조건"], ["outputSchema", "산출물 스키마 ID"]];

// 평가 하네스는 종류 id evaluation 이다. 접두어 판정은 harness-kinds.js 만 한다.
export const EXTERNAL_LANE_X = -480;
export const EXTERNAL_LANE_LABEL = "독립 평가 · 실행 흐름 밖";
export function isEvaluationHarness(node) {
  return node?.kind === "harness" && isEvaluationRole(node.draft?.role ?? node.role);
}
// 평가 하네스를 Workflow 단계에 넣으면 실행 흐름이 된다. 루프 같은 정의 연결은 막지 않는다.
export function evaluationFlowBlock(source, target, slot) {
  if (target?.kind === "step" && (slot === "harness" || slot === "flow") && isEvaluationHarness(source)) {
    return "평가 하네스는 실행 흐름 밖에 있어 Workflow 단계에 연결할 수 없습니다.";
  }
  return "";
}
export function socketDragAllowed(node, direction, spec) {
  return !(isEvaluationHarness(node) && direction === "out" && spec?.execution === false);
}
function customRoleOf(role, type = harnessTypeOf(role)) {
  return type ? role.slice(type.label.length + ROLE_SEPARATOR.length) : role ?? "";
}
function typedRole(type, role) {
  return type ? [type.label, role.trim()].filter(Boolean).join(ROLE_SEPARATOR) : role || "개발";
}
function contractBody(type) {
  const family = HARNESS_CATALOG.families.find(({ id }) => id === type.family);
  return [
    family ? h("p", { class: "studio-note" }, family.label) : null,
    h("dl", { class: "studio-contract-list" }, ...CONTRACT_FIELDS.flatMap(([key, label]) => [h("dt", {}, label),
      h("dd", {}, key === "outputSchema" ? h("code", {}, type[key]) : type[key])])),
  ];
}
export function harnessContractDetails(role, { open = false, visible = false } = {}) {
  const type = harnessTypeOf(role);
  if (!type) return null;
  const title = type.label + " · 유형 계약";
  if (visible) {
    return h("section", { class: "studio-contract", "aria-label": title },
      h("strong", { class: "studio-contract-title" }, title), ...contractBody(type));
  }
  return details(title, open, ...contractBody(type));
}

const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

// 노드의 소켓. slot 이름은 연결 대상 정의 종류와 같다(model·harness·loop), 실행 순서는 flow.
export function socketsOf(node) {
  if (node.kind === "model") return { inputs: [], outputs: [{ slot: "model", type: "model", label: "모델" }] };
  if (node.kind === "harness") {
    const inputs = [{ slot: "model", type: "model", label: "모델" }];
    // 평가 하네스의 정의 출력은 루프 연결용으로만 남긴다. 실행 흐름으로 끌 수 없게 execution 을 끈다.
    if (isEvaluationRole(node.draft?.role)) {
      return { inputs, outputs: [{ slot: "harness", type: "harness", label: "하네스", execution: false }] };
    }
    return { inputs, outputs: [{ slot: "harness", type: "harness", label: "하네스" }] };
  }
  if (node.kind === "loop") {
    return { inputs: [{ slot: "harness", type: "harness", label: "하네스" }], outputs: [{ slot: "loop", type: "loop", label: "루프" }] };
  }
  const type = node.data.type;
  const inputs = type === "start" ? [] : [{ slot: "flow", type: "flow", label: type === "join" || type === "end" ? "입력 (여러 개)" : "입력" }];
  if (type === "agent") inputs.push({ slot: "harness", type: "harness", label: "하네스" });
  if (type === "loop") inputs.push({ slot: "loop", type: "loop", label: "루프" });
  return { inputs, outputs: outputsOf(type).map((port) => ({ slot: port, type: "flow", label: PORT_LABELS[port] })) };
}

export function blankPayload(kind, catalog, template) {
  if (kind === "model") {
    const choice = catalog.engineering.find(({ id }) => id.includes("sonnet")) ?? catalog.engineering[0];
    return { name: "새 모델", provider: choice?.provider ?? "anthropic", model: choice?.id ?? "", reasoning: "" };
  }
  if (kind === "harness") {
    const type = HARNESS_CATALOG.types.find(({ id }) => id === template);
    const [role, instructions] = HARNESS_TEMPLATES[template] ?? ["", ""];
    return { name: type?.label ?? (role ? role + " 하네스" : "새 하네스"), adapter: "claude", model: "",
      role: type?.label ?? (role || "개발"),
      instructions: type ? CONTRACT_FIELDS.map(([key, label]) => `${label}: ${type[key]}`).join("\n\n") : instructions,
      assets: { agents: "", files: [], inputs: [], skills: [], mcp: {}, hooks: {} } };
  }
  if (kind === "loop") {
    return { name: "새 루프", harness: "", attempts: 3, timeoutMs: 600000, budgetCents: 300,
      checks: [{ command: "node", args: ["--test"], code: 0 }] };
  }
  throw new Error("Unknown definition kind: " + kind);
}

export function blankStep(type, workflows, current) {
  const config = {
    agent: { instruction: "" }, loop: { instruction: "" },
    command: { check: { command: "node", args: ["--test"], code: 0 } },
    condition: { source: "", field: "passed", equals: true }, approval: { prompt: "" },
    subgraph: { workflow: workflows.find((item) => item.id !== current)?.id ?? "" },
  };
  return { id: crypto.randomUUID(), type, label: STEP_TYPES[type], inputs: [], outputs: [], ...(config[type] ?? {}) };
}

// 필수 값이 비었는지(노드 아래에 경고로 보여 준다).
export function problemsOf(node, ctx) {
  const list = [];
  if (node.kind === "harness" && !node.ref.model) list.push("모델을 연결하세요.");
  if (node.kind === "loop" && !node.ref.harness) list.push("하네스를 연결하세요.");
  if (node.kind === "model" && !node.draft.model) list.push("모델을 고르세요.");
  if (["model", "harness", "loop"].includes(node.kind) && !node.draft.name?.trim()) list.push("이름을 입력하세요.");
  if (node.kind === "harness" && !node.draft.role?.trim()) list.push("역할을 입력하세요.");
  if (node.kind !== "step") return list.concat(Object.values(node.errors ?? {}));
  const { type } = node.data;
  if (type === "agent" && isEvaluationHarness(ctx.node(node.ref.harness))) list.push("평가 하네스는 실행 흐름 밖에 있어 이 단계에 연결할 수 없습니다.");
  if (type === "agent" && !node.ref.harness) list.push("하네스를 연결하세요.");
  if (type === "loop" && !node.ref.loop) list.push("루프를 연결하세요.");
  if (["agent", "loop"].includes(type) && !node.data.instruction?.trim()) list.push("작업 지시를 입력하세요.");
  if (type === "approval" && !node.data.prompt?.trim()) list.push("승인 안내를 입력하세요.");
  if (type === "condition" && !node.data.source) list.push("기준 단계를 고르세요.");
  if (type === "subgraph" && !node.data.workflow) list.push("호출할 Workflow를 고르세요.");
  if (type !== "start" && !ctx.hasIncoming(node)) list.push("입력을 연결하세요.");
  return list.concat(Object.values(node.errors ?? {}));
}

// ---- 위젯 도우미 -------------------------------------------------------------
function field(label, control, extra = "") {
  return h("label", { class: "studio-field " + extra }, h("span", {}, label), control);
}

function textInput(ctx, node, object, key, props = {}) {
  const { rename, ...rest } = props;
  return h("input", { value: object[key] ?? "", ...rest,
    oninput: (event) => { object[key] = event.target.value; ctx.changed(node, { title: rename }); } });
}

function numberInput(ctx, node, object, key, { min, max, step = 1, scale = 1 }) {
  return h("input", { type: "number", min, max, step, value: object[key] === undefined ? "" : object[key] / scale,
    oninput: (event) => {
      const value = event.target.valueAsNumber;
      object[key] = Number.isFinite(value) ? Math.round(value * scale) : undefined;
      ctx.changed(node);
    } });
}

function textArea(ctx, node, object, key, props = {}) {
  const { list, ...rest } = props;
  const value = object[key];
  return h("textarea", { rows: 3, spellcheck: false, ...rest, value: list ? (value ?? []).join("\n") : value ?? "",
    oninput: (event) => { object[key] = list ? lines(event.target.value) : event.target.value; ctx.changed(node); } });
}

function select(entries, value, onchange, props = {}) {
  const control = h("select", { ...props, onchange: (event) => onchange(event.target.value) },
    ...entries.map(([key, label]) => h("option", { value: key }, label)));
  control.value = value ?? "";
  if (control.selectedIndex < 0 && entries.length) control.value = entries[0][0];
  return control;
}

function jsonArea(ctx, node, label, read, write, key) {
  const raw = node.raw ?? (node.raw = {});
  if (raw[key] === undefined) raw[key] = JSON.stringify(read() ?? {}, null, 2);
  return field(label, h("textarea", { rows: 3, spellcheck: false, value: raw[key], class: "studio-code",
    oninput: (event) => {
      raw[key] = event.target.value;
      node.errors ??= {};
      try {
        const value = JSON.parse(event.target.value || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        write(value);
        delete node.errors[key];
      } catch { node.errors[key] = label + " 설정은 JSON 객체여야 합니다."; }
      ctx.changed(node);
    } }));
}

function details(summary, open, ...children) {
  return h("details", { class: "studio-details", open }, h("summary", {}, summary), ...children);
}

function scopeWidget(ctx, node) {
  if (!node.isNew) return null;
  return field("저장 범위", select(ctx.scopeChoices(), node.owner.scope, (value) => ctx.setScope(node, value)));
}

// ---- 노드별 위젯 -------------------------------------------------------------
function modelWidgets(ctx, node) {
  const draft = node.draft;
  const picker = h("select", { onchange: (event) => {
    [draft.provider, draft.model] = event.target.value ? JSON.parse(event.target.value) : ["", ""];
    ctx.changed(node);
  } });
  showModelOptions(picker, ctx.catalog.engineering, modelKey(draft.provider, draft.model), "모델 선택");
  return [scopeWidget(ctx, node), field("이름", textInput(ctx, node, draft, "name", { maxLength: 240, rename: true })),
    field("모델", picker), field("추론 수준", textInput(ctx, node, draft, "reasoning", { maxLength: 240, placeholder: "OMP 전용 · 비우면 기본" }))];
}

function skillList(ctx, node) {
  const assets = node.draft.assets;
  assets.skills ??= [];
  const host = h("div", { class: "studio-skills" });
  const paint = () => {
    host.replaceChildren(...assets.skills.map((skill, index) => h("div", { class: "studio-skill" },
      h("div", { class: "studio-row" },
        h("input", { value: skill.name, placeholder: "skill-name", maxLength: 64, pattern: "[a-z0-9][a-z0-9\\-]{0,63}",
          oninput: (event) => { skill.name = event.target.value; ctx.changed(node); } }),
        h("button", { type: "button", class: "studio-mini", title: "스킬 삭제", onclick: () => {
          assets.skills.splice(index, 1); paint(); ctx.changed(node);
        } }, "×")),
      h("textarea", { rows: 2, value: skill.markdown, maxLength: 4000, placeholder: "작업 절차 (Markdown)",
        oninput: (event) => { skill.markdown = event.target.value; ctx.changed(node); } }))),
    h("button", { type: "button", class: "studio-mini", disabled: assets.skills.length >= 5,
      onclick: () => { assets.skills.push({ name: "", markdown: "" }); paint(); ctx.changed(node); } }, "+ 스킬"));
  };
  paint();
  return host;
}

function harnessWidgets(ctx, node) {
  const draft = node.draft;
  const type = harnessTypeOf(draft.role);
  const typePicker = h("select", { onchange: (event) => {
    const next = HARNESS_CATALOG.types.find(({ id }) => id === event.target.value);
    const maxLength = next ? 240 - next.label.length - ROLE_SEPARATOR.length : 240;
    draft.role = typedRole(next, customRoleOf(draft.role, type).slice(0, maxLength));
    ctx.changed(node, { rerender: true, refreshInspect: true });
  } }, h("option", { value: "" }, "지정 안 함"), ...HARNESS_CATALOG.families.map((family) =>
    h("optgroup", { label: family.label }, ...HARNESS_CATALOG.types.filter((item) => item.family === family.id)
      .map((item) => h("option", { value: item.id }, item.label)))));
  typePicker.value = type?.id ?? "";
  const roleInput = type ? h("input", { value: customRoleOf(draft.role, type), placeholder: "선택 입력",
    maxLength: 240 - type.label.length - ROLE_SEPARATOR.length, oninput: (event) => {
      draft.role = typedRole(type, event.target.value);
      ctx.changed(node);
    } }) : textInput(ctx, node, draft, "role", { maxLength: 240 });
  draft.assets ??= {};
  const assets = draft.assets;
  const result = draft.result ?? { shape: "", path: "", fields: [] };
  const syncResult = () => {
    if (result.shape) draft.result = { shape: result.shape, path: result.path ?? "", fields: result.fields ?? [] };
    else delete draft.result;
    ctx.changed(node);
  };
  const skillCount = assets.skills?.length ?? 0;
  return [
    scopeWidget(ctx, node),
    field("이름", textInput(ctx, node, draft, "name", { maxLength: 240, rename: true })),
    h("div", { class: "studio-row" },
      field("실행기", select([["claude", "Claude Code"], ["omp", "OMP"]], draft.adapter, (value) => { draft.adapter = value; ctx.changed(node); })),
      field(type ? "세부 역할" : "역할", roleInput)),
    field("하네스 유형", typePicker),
    field("작업 지시", textArea(ctx, node, draft, "instructions", { maxLength: 12000 })),
    details(`규칙 · 자료 · 스킬 ${skillCount} · 결과 형식`, false,
      field("프로젝트 규칙 (AGENTS.md)", textArea(ctx, node, assets, "agents", { maxLength: 10000 })),
      field("저장소 파일 (줄마다 하나)", textArea(ctx, node, assets, "files", { rows: 2, list: true, placeholder: "docs/review-rules.md" })),
      field("Workflow 입력 이름 (줄마다 하나)", textArea(ctx, node, assets, "inputs", { rows: 2, list: true, placeholder: "test_results" })),
      field("스킬 (최대 5개)", skillList(ctx, node)),
      h("div", { class: "studio-row" },
        field("결과 형식", select([["", "자유 형식"], ["object", "JSON 객체"], ["array", "JSON 객체 목록"]], result.shape,
          (value) => { result.shape = value; syncResult(); })),
        field("결과 파일", h("input", { value: result.path ?? "", placeholder: "review.json",
          oninput: (event) => { result.path = event.target.value; syncResult(); } }))),
      field("필수 필드 (줄마다 하나)", h("textarea", { rows: 2, value: (result.fields ?? []).join("\n"),
        oninput: (event) => { result.fields = lines(event.target.value); syncResult(); } })),
      jsonArea(ctx, node, "MCP", () => assets.mcp, (value) => { assets.mcp = value; }, "mcp"),
      jsonArea(ctx, node, "Hooks", () => assets.hooks, (value) => { assets.hooks = value; }, "hooks")),
  ];
}

function checkEditor(ctx, node, checks) {
  const host = h("div", { class: "studio-checks" });
  const paint = () => {
    host.replaceChildren(...checks.map((check, index) => h("div", { class: "studio-check" },
      h("div", { class: "studio-row" },
        field("실행 파일", h("input", { value: check.command, maxLength: 240,
          oninput: (event) => { check.command = event.target.value; ctx.changed(node); } })),
        field("종료 코드", h("input", { type: "number", min: 0, max: 255, value: check.code ?? 0, class: "studio-narrow",
          oninput: (event) => { check.code = event.target.valueAsNumber; ctx.changed(node); } })),
        h("button", { type: "button", class: "studio-mini", title: "명령 삭제", disabled: checks.length < 2,
          onclick: () => { checks.splice(index, 1); paint(); ctx.changed(node, { rerender: true }); } }, "×")),
      field("인수 (줄마다 하나)", h("textarea", { rows: 1, value: check.args.join("\n"), spellcheck: false,
        oninput: (event) => { check.args = event.target.value.split(/\r?\n/).filter((line) => line !== ""); ctx.changed(node); } })))),
    h("button", { type: "button", class: "studio-mini", disabled: checks.length >= 10,
      onclick: () => { checks.push({ command: "node", args: ["--test"], code: 0 }); paint(); ctx.changed(node, { rerender: true }); } }, "+ 검증 명령"));
  };
  paint();
  return host;
}

const commandLine = ({ command, args }) => [command, ...args].join(" ");

function loopWidgets(ctx, node) {
  const draft = node.draft;
  return [
    scopeWidget(ctx, node),
    field("이름", textInput(ctx, node, draft, "name", { maxLength: 240, rename: true })),
    h("div", { class: "studio-row studio-row-3" },
      field("최대 시도", numberInput(ctx, node, draft, "attempts", { min: 1, max: 8 })),
      field("제한(초)", numberInput(ctx, node, draft, "timeoutMs", { min: .1, max: 3600, step: .001, scale: 1000 })),
      field(typeof engineeringBudgetLabel === "function" ? engineeringBudgetLabel("loop") : "예산(센트)", numberInput(ctx, node, draft, "budgetCents", { min: 0, max: 100000 }))),
    details("검증 명령 · " + draft.checks.map(commandLine).join(", "), false, checkEditor(ctx, node, draft.checks)),
  ];
}

function versionPicker(ctx, node, slot) {
  const target = ctx.node(node.ref[slot]);
  if (!target) return null;
  const latest = target.record?.version;
  if (!latest) return h("p", { class: "studio-note" }, "연결된 정의를 저장하면 최신 버전으로 고정됩니다.");
  const entries = [];
  for (let version = latest; version > 0; version--) entries.push([String(version), "v" + version + (version === latest ? " (최신)" : "")]);
  const control = select(entries, String(node.version ?? latest), (value) => {
    node.version = Number(value);
    ctx.changed(node, { rerender: true });
  });
  const stale = node.version && node.version < latest;
  return field(stale ? "고정 버전 · 최신 아님" : "고정 버전", control, stale ? "is-stale" : "");
}

function contractWidget(ctx, node) {
  const data = node.data;
  const count = (data.inputs?.length ?? 0) + (data.outputs?.length ?? 0);
  return details("산출물 입출력" + (count ? " · " + count : ""), false,
    jsonArea(ctx, node, "입력·출력 (JSON)", () => ({ inputs: data.inputs ?? [], outputs: data.outputs ?? [] }),
      (value) => { data.inputs = value.inputs ?? []; data.outputs = value.outputs ?? []; }, "contract"));
}

const CONDITIONS = [["passed:true", "검증 통과"], ["passed:false", "검증 실패"], ["status:succeeded", "상태 = 완료"],
  ["status:failed", "상태 = 실패"], ["status:skipped", "상태 = 건너뜀"]];

function stepWidgets(ctx, node) {
  const data = node.data;
  const { type } = data;
  if (type === "start" || type === "end") return [h("p", { class: "studio-note" }, type === "start" ? "Workflow가 여기서 시작합니다." : "모든 갈래가 여기서 끝납니다.")];
  const label = field("이름", textInput(ctx, node, data, "label", { maxLength: 240, rename: true }));
  if (type === "agent") {
    return [label, versionPicker(ctx, node, "harness"),
      field("작업 지시", textArea(ctx, node, data, "instruction", { maxLength: 12000 })), contractWidget(ctx, node)];
  }
  if (type === "loop") {
    return [label, versionPicker(ctx, node, "loop"), field("작업 지시", textArea(ctx, node, data, "instruction", { maxLength: 12000 })),
      contractWidget(ctx, node)];
  }
  if (type === "command") {
    data.check ??= { command: "node", args: [], code: 0 };
    return [label, checkEditor(ctx, node, [data.check]).firstElementChild, contractWidget(ctx, node)];
  }
  if (type === "condition") {
    return [label,
      field("기준 단계", select([["", "단계 선택"], ...ctx.stepChoices(node)], data.source, (value) => { data.source = value; ctx.changed(node); })),
      field("조건", select(CONDITIONS, `${data.field}:${data.equals}`, (value) => {
        const [fieldName, equals] = value.split(":");
        data.field = fieldName;
        data.equals = fieldName === "passed" ? equals === "true" : equals;
        ctx.changed(node);
      }))];
  }
  if (type === "approval") return [label, field("개입 유형", select([["", "일반 승인"], ["browser", "브라우저 · 직접 처리"], ["payment", "결제 · 직접 처리"], ["consent", "약관 동의 · 직접 처리"], ["password", "비밀번호 · 직접 입력"], ["system", "시스템 변경 · 직접 확인"], ["uac", "Windows UAC · 직접 승인"]], data.gate ?? "", (value) => { if (value) data.gate = value; else delete data.gate; ctx.changed(node); })), field("승인 안내", textArea(ctx, node, data, "prompt", { maxLength: 2000 })), h("p", { class: "studio-note" }, "민감한 조작은 사용자가 원래 창에서 직접 처리합니다. 이 카드에 비밀번호나 결제 정보를 입력하지 마세요.")];
  if (type === "subgraph") {
    const target = ctx.workflows().find(({ id }) => id === data.workflow);
    const versions = [["", "최신"]];
    for (let version = target?.version ?? 0; version > 0; version--) versions.push([String(version), "v" + version]);
    return [label,
      field("Workflow", select([["", "Workflow 선택"], ...ctx.workflows().filter(({ id }) => id !== ctx.currentWorkflow())
        .map(({ id, name }) => [id, name])], data.workflow, (value) => { data.workflow = value; delete data.version; ctx.changed(node, { rerender: true }); })),
      field("버전", select(versions, data.version ? String(data.version) : "", (value) => {
        if (value) data.version = Number(value); else delete data.version;
        ctx.changed(node);
      }))];
  }
  return [label];
}

export function widgetsOf(node, ctx) {
  const build = { model: modelWidgets, harness: harnessWidgets, loop: loopWidgets, step: stepWidgets }[node.kind];
  return build(ctx, node).filter(Boolean);
}
