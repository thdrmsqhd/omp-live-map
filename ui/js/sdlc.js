// 개발 Task 칸반. 폼은 없다.
//  - 칸: 제목 두 번 누르기 = 이름 바꾸기, 칸 머리 끌기 = 순서 바꾸기, '＋ 칸' = 칸 더하기, 칸 ⋯ = 지우기(카드는 Backlog 로).
//  - Backlog 맨 아래 ＋ = 한 줄(글 + Workflow 칩)로 카드 만들기. 카드 ▶ = 그 Workflow 로 프로젝트 폴더에서 실행.
//  - 카드를 끌어 Backlog·준비·보류·사용자 칸으로 옮긴다(진행 중·승인 대기·완료는 실행이 정한다).
import { taskCard, quickLine, TASK_DEFAULTS } from "./sdlc-card.js";
import { bindSummary } from "./sdlc-summary.js";

const STATUS = { backlog: "Backlog", ready: "준비", running: "진행 중", waiting_approval: "승인 대기", blocked: "보류", completed: "완료" };
const DEFAULT_STAGES = Object.entries(STATUS).map(([status, label], position) => ({ status, label, position, builtin: true }));
const RUN_COLUMNS = new Set(["running", "waiting_approval", "completed"]);
const FLOW_KEY = "omp-tasks-flow";

export function bindSdlc({ find, request, report, showRun, need }) {
  const board = find("sdlc-board");
  const summary = bindSummary({ find, request, need });
  const open = new Set(), flushers = new Map(), pending = new Map();
  let project = "", tasks = [], stages = DEFAULT_STAGES, workflows = [], presets = [], definitions = null, quick = null, refreshing = false;
  const described = new Map();
  let dragging = null, rename = null;
  const editing = () => (board.contains(document.activeElement) && /^(input|textarea|select)$/i.test(document.activeElement.tagName))
    || Boolean(document.querySelector(".inline-menu")) || Boolean(dragging);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(Boolean));
    return node;
  };

  // Workflow 칩: 템플릿 8종 + 이 프로젝트에서 쓸 수 있는 저장 Workflow(템플릿 사본·자동 사본은 템플릿으로 묶는다).
  function flowOptions() {
    const presetNames = new Set(presets.map(({ name }) => name));
    return [["템플릿", presets.map((preset) => ({ value: "preset:" + preset.id, name: preset.name, title: preset.summary,
      id: workflows.find(({ name }) => name === preset.name)?.id ?? null }))],
    ["저장된 Workflow", workflows.filter(({ generated, name }) => !generated && !presetNames.has(name))
      .map((flow) => ({ value: "flow:" + flow.id, id: flow.id, name: engineeringWorkflowLabel(flow), title: "" }))]];
  }
  const allFlows = () => flowOptions().flatMap(([, items]) => items);
  const lastFlow = () => { const saved = readJSON(FLOW_KEY, ""); return allFlows().some(({ value }) => value === saved) ? saved : "preset:feature"; };

  async function create(text, value, run) {
    const owner = await need();
    const body = value.startsWith("preset:") ? { project: owner, text, template: value.slice(7) }
      : { project: owner, text, workflow: value.slice(5), version: workflows.find(({ id }) => id === value.slice(5))?.version };
    const task = await request("tasks", {}, body);
    writeJSON(FLOW_KEY, value);
    await refresh(true, true);
    if (run) { quick = null; await runTask(tasks.find(({ id }) => id === task.id) ?? task); }
  }
  async function runTask(task) {
    await flushers.get(task.id)?.();
    const warning = engineeringRuntimeWarning(await request("runtime").catch(() => null));
    if (warning && !window.confirm(warning + "\n\n그래도 실행할까요?")) return;
    const key = pending.get(task.id) ?? crypto.randomUUID();
    pending.set(task.id, key);
    const run = await request("tasks/run", {}, { id: task.id, key });
    pending.delete(task.id);
    await refresh(false, true);
    await showRun(run.id);
  }
  async function save(task, patch, { quiet } = {}) {
    // 주기 갱신이 목록을 새 객체로 바꿨을 수 있으므로 지금 목록의 같은 카드에도 반영한다(리비전이 어긋나지 않게).
    const latest = tasks.find(({ id }) => id === task.id) ?? task;
    const saved = await request("tasks", {}, { project, id: task.id, revision: latest.revision, ...patch });
    const fields = { ...saved, timeoutMs: saved.timeout_ms ?? TASK_DEFAULTS.minutes * 60000, budgetCents: saved.budget_cents ?? TASK_DEFAULTS.budgetCents };
    for (const target of new Set([task, latest, tasks.find(({ id }) => id === task.id)])) if (target) Object.assign(target, fields);
    if (!quiet) paint(true);
  }
  async function move(task, status) {
    const latest = tasks.find(({ id }) => id === task.id) ?? task;
    await request("tasks/move", {}, { id: task.id, status, revision: latest.revision });
    await refresh(false, true);
  }
  async function stageCall(endpoint, body) {
    const owner = await need();
    stages = await request(endpoint, {}, { project: owner, ...body });
    paint(true);
  }

  // 칩 title: 단계마다 어떤 하네스·Loop 가 도는지(model/workflow-summary.js). 프로젝트에 아직 없는 템플릿은 요약만 보여 준다.
  async function describe(value) {
    const option = allFlows().find((item) => item.value === value);
    if (!option?.id || !project) return option?.title ?? "";
    if (!described.has(value)) {
      described.set(value, (async () => {
        definitions ??= await request("definitions", { project });
        const flow = await request("workflow", { project, id: option.id });
        return [option.title, ...workflowStepSummaries(flow.payload, definitions)].filter(Boolean).join("\n");
      })().catch(() => option.title ?? ""));
    }
    return described.get(value);
  }

  const ctx = { open, flushers, describe, report, showRun, move, save, run: runTask, create, flowOptions, lastFlow,
    rememberFlow: (value) => writeJSON(FLOW_KEY, value), closeQuick: () => { quick = null; paint(true); },
    statusLabel: (status) => stages.find((stage) => stage.status === status)?.label ?? STATUS[status] ?? status,
    paint: () => paint(true), get stages() { return stages; } };

  function columnHead(stage) {
    const title = el("h3", { className: "sdlc-col-title", textContent: stage.label, title: "두 번 눌러 이름 바꾸기 · 끌어서 순서 바꾸기" });
    const startRename = () => inlineEdit(title, { value: stage.label, label: "칸 이름",
      onSave: (label) => label ? stageCall("sdlc-stages", { status: stage.status, label }) : undefined });
    title.ondblclick = startRename;
    const more = el("button", { type: "button", className: "sdlc-more", textContent: "⋯", title: "칸 메뉴" });
    more.setAttribute("aria-label", stage.label + " 칸 메뉴");
    more.onclick = () => inlineMenu(more, [{ label: "이름 바꾸기", run: startRename },
      { label: "칸 지우기", disabled: stage.builtin, title: stage.builtin ? "기본 칸은 실행 상태와 이어져 있어 지울 수 없습니다. 이름만 바꿀 수 있습니다." : "카드는 Backlog로 돌아갑니다",
        run: report(async () => stageCall("sdlc-stages/remove", { status: stage.status })) }]);
    const count = el("span", { className: "sdlc-count", textContent: String(tasks.filter(({ status }) => status === stage.status).length) });
    const head = el("header", { className: "sdlc-col-head", draggable: true }, title, count, more);
    head.addEventListener("dragstart", (event) => {
      if (event.target.closest("button, input")) return;
      dragging = { column: stage.status };
      event.dataTransfer.setData("text/x-omp-column", stage.status);
      event.dataTransfer.effectAllowed = "move";
    });
    head.addEventListener("dragend", () => { dragging = null; paint(true); });
    if (rename === stage.status) { rename = null; setTimeout(startRename); }
    return head;
  }
  function column(stage) {
    const section = el("section", { className: "sdlc-col" });
    section.dataset.status = stage.status;
    const cards = el("div", { className: "sdlc-cards" }, ...tasks.filter(({ status }) => status === stage.status).map((task) => taskCard(task, ctx)));
    section.append(columnHead(stage), cards);
    if (stage.status === "backlog") {
      section.append(quick ? quickLine(ctx, quick) : el("button", { type: "button", className: "sdlc-add-task", textContent: "＋",
        title: "Task 한 줄로 만들기", onclick: () => { quick = {}; paint(true); } }));
      section.querySelector(".sdlc-add-task")?.setAttribute("aria-label", "Backlog에 Task 추가");
    }
    section.addEventListener("dragover", (event) => {
      const types = event.dataTransfer.types;
      if (types.includes("text/x-omp-column") || (types.includes("text/x-omp-task") && !RUN_COLUMNS.has(stage.status))) {
        event.preventDefault();
        section.classList.add("is-drop");
      }
    });
    section.addEventListener("dragleave", () => section.classList.remove("is-drop"));
    section.addEventListener("drop", report(async (event) => {
      section.classList.remove("is-drop");
      const moving = event.dataTransfer.getData("text/x-omp-column"), card = event.dataTransfer.getData("text/x-omp-task");
      dragging = null;
      if (moving && moving !== stage.status) {
        const order = stages.map(({ status }) => status).filter((status) => status !== moving);
        order.splice(order.indexOf(stage.status), 0, moving);
        await stageCall("sdlc-stages/order", { order });
      }
      const task = card && tasks.find(({ id }) => id === card);
      if (task && task.status !== stage.status) await move(task, stage.status);
    }));
    return section;
  }
  function paint(force = false) {
    if (!force && editing()) return;
    const add = el("button", { type: "button", className: "sdlc-add-col", textContent: "＋ 칸", title: "칸 더하기" });
    add.onclick = report(async () => {
      const before = new Set(stages.map(({ status }) => status));
      await stageCall("sdlc-stages/add", { label: "새 칸" });
      rename = stages.find(({ status }) => !before.has(status))?.status ?? null;
      paint(true);
    });
    board.replaceChildren(...stages.map(column), add);
  }
  function paintInbox(approvals) {
    find("sdlc-inbox").replaceChildren(...approvals.map((approval) => {
      const review = el("button", { type: "button", textContent: "승인 검토", onclick: report(async () => showRun(approval.run)) });
      return el("li", {}, approval.title + " · " + approval.prompt + " ", review);
    }));
  }

  async function refresh(full = false, force = false) {
    const owner = project;
    if (!presets.length) presets = await request("workflows/presets").catch(() => []);
    if (!owner) { tasks = []; stages = DEFAULT_STAGES; workflows = []; paint(force); paintInbox([]); return; }
    const [rows, approvals, columns, flows] = await Promise.all([request("tasks", { project: owner }),
      request("workflow-approvals", { project: owner }),
      full ? request("sdlc-stages", { project: owner }) : null,
      full ? request("workflows", { project: owner }) : null]);
    if (owner !== project) return;
    tasks = rows;
    if (columns) stages = columns;
    if (flows) workflows = flows;
    paint(force);
    paintInbox(approvals);
  }

  setInterval(async () => {
    if (refreshing || find("engineering").hidden || !project) return;
    refreshing = true;
    try { await refresh(); } catch { /* 다음 주기에 다시 받는다 */ } finally { refreshing = false; }
  }, 2000);
  setInterval(() => { if (!find("engineering").hidden) void summary.refresh().catch(() => {}); }, 15000);

  return {
    async selectProject(id) {
      if (id === project) return refresh(true, true);
      project = id; tasks = []; workflows = []; definitions = null; described.clear(); open.clear();
      await Promise.all([refresh(true, true), summary.load(id)]);
    },
    // ＋ 새 실행·설계의 '실행 시작': Backlog ＋ 줄을 열고 Workflow 를 미리 고른다(run 이면 Enter = 만들고 실행).
    openQuick({ workflow, run } = {}) {
      quick = { workflow, run: Boolean(run) };
      paint(true);
      board.querySelector(".sdlc-quick")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  };
}
