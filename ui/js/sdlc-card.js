// Task 카드: 제목 · Workflow 칩 · ▶. 카드를 누르면 그 자리에서 펼쳐져 본문(자동 저장)·시간 한도·예산을 바로 고친다.
// 저장 버튼은 없다. 본문은 입력을 멈추고 0.7초 뒤에 저장하고, 숫자는 눌러서 고친 뒤 Enter·포커스 이동으로 저장한다(Esc 취소).
export const TASK_DEFAULTS = { minutes: 20, budgetCents: 6000 };
const ACTIVE = new Set(["running", "waiting_approval"]);
const MANUAL = (stage) => !["running", "waiting_approval", "completed"].includes(stage.status);
export const dollars = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
};

export function taskCard(task, ctx) {
  const opened = ctx.open.has(task.id), busy = ACTIVE.has(task.status);
  const card = el("article", { className: "sdlc-card" + (opened ? " is-open" : "") });
  card.dataset.id = task.id;
  card.draggable = !busy;
  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/x-omp-task", task.id);
    event.dataTransfer.effectAllowed = "move";
  });
  const title = el("h4", { className: "sdlc-card-title", textContent: task.title, title: "누르면 펼침 · 두 번 누르면 제목 고치기" });
  const run = el("button", { type: "button", className: "sdlc-run", textContent: "▶", disabled: busy,
    title: busy ? "실행 중입니다" : `실행 · ${task.workflow_name} · ${Math.round(task.timeoutMs / 60000)}분 · ${dollars(task.budgetCents)}` });
  run.setAttribute("aria-label", task.title + " 실행");
  run.onclick = ctx.report(async (event) => { event.stopPropagation(); await ctx.run(task); });
  const more = el("button", { type: "button", className: "sdlc-more", textContent: "⋯", title: "옮기기 · 실행 이력" });
  more.setAttribute("aria-label", task.title + " 메뉴");
  more.onclick = (event) => {
    event.stopPropagation();
    const items = ctx.stages.filter((stage) => MANUAL(stage) && stage.status !== task.status)
      .map((stage) => ({ label: stage.label + "(으)로 옮기기", disabled: busy, run: ctx.report(async () => ctx.move(task, stage.status)) }));
    if (task.latest_run) items.push({ label: "실행 이력 보기", run: ctx.report(async () => ctx.showRun(task.latest_run)) });
    inlineMenu(more, items.length ? items : [{ label: "옮길 칸이 없습니다", disabled: true }]);
  };
  const head = el("div", { className: "sdlc-card-head" }, title, run, more);
  head.onclick = (event) => {
    if (event.target.closest("button, input")) return;
    if (opened) ctx.open.delete(task.id); else ctx.open.add(task.id);
    ctx.paint();
  };
  title.ondblclick = (event) => {
    event.stopPropagation();
    if (busy) return;
    inlineEdit(title, { value: task.title, label: "Task 제목", onSave: (value) => value && ctx.save(task, { title: value }) });
  };
  const meta = el("p", { className: "sdlc-card-meta" }, el("span", { className: "sdlc-chip", textContent: task.workflow_name }),
    task.latest_run ? el("span", { textContent: ctx.statusLabel(task.status) }) : null);
  card.append(head, meta);
  if (opened) card.append(cardBody(task, ctx, busy));
  return card;
}

function cardBody(task, ctx, busy) {
  const body = el("textarea", { className: "sdlc-body", value: task.instruction, rows: 5, maxLength: 12000, disabled: busy,
    placeholder: "무엇을 할지 적어 주세요. '완료 조건:'으로 시작하는 줄을 쓰면 기본 완료 조건 대신 그 내용을 씁니다." });
  body.setAttribute("aria-label", task.title + " 본문");
  const saved = el("small", { className: "sdlc-saved" });
  let timer = 0;
  const flush = async () => {
    clearTimeout(timer);
    timer = 0;
    if (body.value === task.instruction) return;
    saved.textContent = "저장 중…";
    try { await ctx.save(task, { instruction: body.value }, { quiet: true }); saved.textContent = "저장됨"; }
    catch (error) { saved.textContent = error.message; }
  };
  body.addEventListener("input", () => { saved.textContent = ""; clearTimeout(timer); timer = setTimeout(flush, 700); });
  body.addEventListener("blur", () => { if (timer) void flush(); });
  ctx.flushers.set(task.id, flush);
  const number = (text, label, onEdit) => {
    const button = el("button", { type: "button", className: "inline-num", textContent: text, disabled: busy });
    button.setAttribute("aria-label", label + " 고치기");
    button.onclick = (event) => { event.stopPropagation(); onEdit(button); };
    return button;
  };
  const minutes = Math.round(task.timeoutMs / 60000);
  const limit = number(minutes + "분", "시간 한도", (button) => inlineEdit(button, { value: String(minutes), type: "number", min: 1, max: 60,
    label: "시간 한도(분)", placeholder: "기본 " + TASK_DEFAULTS.minutes,
    onSave: (value) => ctx.save(task, { timeoutMs: value === "" ? null : Math.round(Number(value)) * 60000 }) }));
  const budget = number(dollars(task.budgetCents), "예산", (button) => inlineEdit(button, { value: (task.budgetCents / 100).toFixed(2), type: "number",
    min: 0, max: 1000, step: 0.01, label: "실행 예산(달러)", placeholder: "기본 " + dollars(TASK_DEFAULTS.budgetCents),
    onSave: (value) => ctx.save(task, { budgetCents: value === "" ? null : Math.round(Number(value) * 100) }) }));
  const limits = el("p", { className: "sdlc-limits" }, "시간 한도 ", limit, " · 예산 ", budget,
    el("small", { textContent: " · 비우면 기본값(" + TASK_DEFAULTS.minutes + "분 · " + dollars(TASK_DEFAULTS.budgetCents) + ")" }));
  return el("div", { className: "sdlc-card-body" }, body, saved, limits);
}

// Backlog 맨 아래 ＋ 한 줄: 글 + Workflow 칩. Enter 로 카드를 만든다(run 이면 바로 실행까지).
export function quickLine(ctx, { workflow, run } = {}) {
  const input = el("input", { className: "sdlc-quick-text", placeholder: run ? "무엇을 할까요? Enter = 만들고 실행" : "무엇을 할까요? Enter = 카드 만들기",
    maxLength: 12000, spellcheck: false });
  input.setAttribute("aria-label", "새 Task");
  const chip = el("select", { className: "sdlc-chip sdlc-flow-chip" });
  chip.setAttribute("aria-label", "Workflow");
  const groups = ctx.flowOptions();
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const group = el("optgroup", { label });
    group.append(...items.map(({ value, name, title }) => Object.assign(new Option(name, value), { title: title || "" })));
    chip.append(group);
  }
  const wanted = workflow && groups.flatMap(([, items]) => items).find(({ id }) => id === workflow);
  chip.value = wanted?.value ?? ctx.lastFlow();
  if (!chip.value && chip.options.length) chip.selectedIndex = 0;
  const showTitle = () => {
    const value = chip.value;
    chip.title = groups.flatMap(([, items]) => items).find((item) => item.value === value)?.title ?? "";
    void ctx.describe(value).then((text) => { if (chip.value === value && text) chip.title = text; });
  };
  showTitle();
  chip.onchange = () => { ctx.rememberFlow(chip.value); showTitle(); input.focus(); };
  const line = el("div", { className: "sdlc-quick" + (run ? " is-run" : "") }, input, chip);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); ctx.closeQuick(); return; }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const text = input.value.trim();
    if (!text || input.disabled) return;
    input.disabled = true;
    void ctx.report(async () => {
      try { await ctx.create(text, chip.value, run); input.value = ""; } finally { input.disabled = false; input.focus(); }
    })();
  });
  setTimeout(() => input.focus());
  return line;
}
