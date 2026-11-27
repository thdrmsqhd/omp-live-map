/* omp-live-map · view · 맵 오른쪽 서랍. 단계·하네스·루프·Task 를 그 자리에서 고친다(저장 버튼 없음: 입력을 멈추면 0.7초 뒤·포커스 이동 때 저장).
   단계 서랍의 범위 토글: '이 Task만'(기본, Task 전용 사본) · '템플릿'(원본의 새 버전). 서버: tasks/stage(engineering/task-local.js). */

const UMD = { kind: "", key: "", flush: [] };
function umEl(tag, props = {}, ...children) {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  for (const [key, value] of Object.entries(dataset || {})) node.dataset[key] = value;
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
function openUmapDrawer(kind, key, title, body, wide = false) {
  void flushUmapDrawer();
  Object.assign(UMD, { kind, key, flush: [] });
  const drawer = $("umap-drawer");
  drawer.hidden = false;
  drawer.classList.toggle("wide", wide);
  drawer.dataset.kind = kind;
  $("umap-drawer-title").textContent = title;
  $("umap-drawer-body").replaceChildren(...body);
  $("umap").classList.add("drawer-open");
}
async function flushUmapDrawer() { for (const flush of UMD.flush.splice(0)) await flush(); }
function closeUmapDrawer() {
  void flushUmapDrawer();
  $("umap-drawer").hidden = true;
  UMD.kind = UMD.key = "";
  $("umap").classList.remove("drawer-open");
  if (typeof UnifiedProjectContext !== "undefined" || window.UnifiedProjectContext) window.UnifiedProjectContext?.hide();
}

// 입력 한 칸(자동 저장). save(value) 가 실패하면 그 줄에 이유를 쓴다.
function umapField(label, value, save, { multiline = false, type = "text", min, max, step, rows = 4, hint = "", placeholder = "", disabled = false } = {}) {
  const input = multiline ? umEl("textarea", { value: value ?? "", rows, spellcheck: false, placeholder, disabled })
    : umEl("input", { type, value: value ?? "", spellcheck: false, placeholder, disabled });
  for (const [key, limit] of Object.entries({ min, max, step })) if (limit !== undefined) input[key] = limit;
  const note = umEl("small", { className: "um-note" }, hint);
  let timer = 0, last = String(value ?? "");
  const flush = async () => {
    clearTimeout(timer);
    timer = 0;
    if (input.value === last) return;
    const next = input.value;
    note.textContent = "저장 중…";
    note.classList.remove("err");
    try { await save(next.trim()); last = next; note.textContent = "저장됨"; }
    catch (error) { note.textContent = error.message; note.classList.add("err"); }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(flush, 700); note.textContent = ""; });
  input.addEventListener("change", () => { if (input.tagName === "SELECT") void flush(); });
  input.addEventListener("blur", () => { if (timer) void flush(); });
  UMD.flush.push(flush);
  return umEl("label", { className: "um-field" }, umEl("span", {}, label), input, note);
}
function umapSelectField(label, options, value, save, hint = "") {
  const select = umEl("select", {}, ...options.map(([id, name]) => new Option(name, id)));
  select.value = value ?? "";
  const note = umEl("small", { className: "um-note" }, hint);
  select.addEventListener("change", async () => {
    note.textContent = "저장 중…";
    try { await save(select.value); note.textContent = "저장됨"; } catch (error) { note.textContent = error.message; note.classList.add("err"); }
  });
  return umEl("label", { className: "um-field" }, umEl("span", {}, label), select, note);
}
const umapSection = (title, ...children) => umEl("section", { className: "um-dsec" }, umEl("h3", {}, title), ...children);
const umapParseCommand = (text) => { const [command, ...args] = String(text).trim().split(/\s+/).filter(Boolean); return { command, args, code: 0 }; };
const umapCommandText = (check) => check ? [check.command, ...(check.args || [])].join(" ") : "";

function umapScopeToggle(state, flowName) {
  const note = umEl("small", { className: "um-note" });
  const paint = () => {
    for (const button of seg.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.scope === state.scope));
    note.textContent = state.scope === "task" ? "이 Task 전용 사본에 저장합니다. 같은 Workflow 를 쓰는 다른 Task 는 그대로입니다."
      : "‘" + flowName + "’ 템플릿의 새 버전으로 저장하고 이 Task 를 그 버전에 고정합니다.";
  };
  const seg = umEl("div", { className: "um-seg", role: "group" },
    umEl("button", { type: "button", textContent: "이 Task만", dataset: { scope: "task" }, onclick: () => { state.scope = "task"; paint(); } }),
    umEl("button", { type: "button", textContent: "템플릿", dataset: { scope: "template" }, onclick: () => { state.scope = "template"; paint(); } }));
  seg.setAttribute("aria-label", "저장 범위");
  paint();
  return umEl("div", { className: "um-scope" }, umEl("span", {}, "저장 범위"), seg, note);
}

function umapSessionLinks(stage) {
  if (!stage.sessions?.length) return umEl("p", { className: "um-muted" }, stage.status === "pending" ? "아직 실행하지 않은 단계입니다." : "이 단계에서 돈 세션 기록이 없습니다.");
  const index = umapSessionIndex();
  return umEl("ul", { className: "um-dlist" }, ...stage.sessions.map((entry) => {
    const node = index.get(entry.sessionId);
    const name = node ? (ALIAS.get(node.id) || node.sessionTitle || node.title) : "세션 " + entry.sessionId.slice(0, 8) + " · 기록 없음";
    const open = node ? umEl("button", { type: "button", textContent: "열기", onclick: () => umapOpenSession(node.id) }) : null;
    return umEl("li", {}, umEl("span", {}, `시도 ${entry.attempt}${entry.retry ? " · 재시도 " + entry.retry : ""} · ${name}${entry.costCents !== null ? " · " + umapDollars(entry.costCents) : ""}`), open);
  }));
}

async function openStageDrawer(taskId, node, focus = "stage") {
  const task = umapTaskById(taskId), stage = task?.stages.find(({ id }) => id === node);
  if (!stage) return;
  const project = umapProjectOf(taskId), state = { scope: "task" };
  const save = (patch) => umapEditStage(taskId, node, state.scope, patch);
  const flowName = (task.workflow?.name || "").replace(/ · Task [0-9a-f-]{8}$/, "");
  const body = [umapScopeToggle(state, flowName)];
  const status = umEl("p", { className: "um-dstate s-" + stage.status }, (UMAP_STAGE_STATE[stage.status] || stage.status) + " · " + (UMAP_KIND[stage.type] || stage.type));
  body.push(status);
  if (stage.status === "waiting_approval" && task.run) {
    body.push(umEl("div", { className: "um-approve wide" }, umEl("p", {}, stage.waiting?.prompt || stage.prompt || ""),
      umEl("button", { type: "button", className: "go", textContent: "승인", onclick: () => void umapDecide(task.run.id, node, "approved").then(closeUmapDrawer, (error) => umapToast(error.message)) }),
      umEl("button", { type: "button", className: "stop", textContent: "반려…", onclick: (event) => inlineEdit(event.currentTarget, { value: "", label: "반려 이유", placeholder: "반려 이유 · Enter",
        onSave: (reason) => reason ? umapDecide(task.run.id, node, "rejected", reason).then(closeUmapDrawer) : undefined }) })));
  }
  const fields = [umapField("단계 이름", stage.label, (label) => save({ stage: { label } }))];
  if (stage.type === "agent" || stage.type === "loop") fields.push(umapField("단계 지시", stage.instruction, (instruction) => save({ stage: { instruction } }), { multiline: true, rows: 5 }));
  if (stage.type === "approval") fields.push(umapField("승인 안내", stage.prompt, (prompt) => save({ stage: { prompt } }), { multiline: true, rows: 4 }));
  if (stage.type === "command") fields.push(umapField("검증 명령", umapCommandText(stage.check), (text) => save({ stage: { check: umapParseCommand(text) } }), { hint: "예: node --test" }));
  body.push(umapSection("단계", ...fields));
  if (stage.harness) {
    const definitions = await umapDefinitions(project).catch(() => []);
    const harness = definitions.find(({ id }) => id === stage.harness.id);
    const models = definitions.filter((item) => item.kind === "model" && (!harness || (item.scope === harness.scope && item.project === harness.project && item.team === harness.team)));
    const options = models.map((model) => [model.id, model.name + " · " + model.payload.model]);
    if (stage.harness.model && !options.some(([id]) => id === stage.harness.model.id)) options.unshift([stage.harness.model.id, stage.harness.model.name]);
    body.push(umapSection("하네스 · " + stage.harness.name, umEl("p", { className: "um-muted" }, (stage.harness.adapter === "omp" ? "OMP" : "Claude Code") + " · v" + stage.harness.version + " · " + ({ personal: "개인", team: "팀", project: "프로젝트" }[stage.harness.scope] || "")),
      umapField("역할", stage.harness.role, (role) => save({ harness: { role } })),
      umapField("하네스 지시", stage.harness.instructions, (instructions) => save({ harness: { instructions } }), { multiline: true, rows: 6 }),
      umapSelectField("모델", options, stage.harness.model?.id, (model) => save({ harness: { model } }))));
  }
  if (stage.loop) {
    body.push(umapSection("루프 · " + stage.loop.name,
      umapField("최대 시도", String(stage.loop.attempts), (value) => save({ loop: { attempts: Math.round(Number(value)) } }), { type: "number", min: 1, max: 8 }),
      umapField("시간 한도(분)", String(Math.round(stage.loop.timeoutMs / 60000)), (value) => save({ loop: { timeoutMs: Math.round(Number(value) * 60000) } }), { type: "number", min: 1, max: 60 }),
      umapField("예산($)", (stage.loop.budgetCents / 100).toFixed(2), (value) => save({ loop: { budgetCents: Math.round(Number(value) * 100) } }), { type: "number", min: 0, max: 1000, step: 0.01 }),
      umapField("검증 명령", stage.loop.checks.map(umapCommandText).join("\n"), (text) => save({ loop: { checks: text.split(/\n+/).filter(Boolean).map(umapParseCommand) } }),
        { multiline: true, rows: 2, hint: "한 줄에 명령 하나 · 모두 통과해야 루프가 끝납니다" })));
  }
  const log = umEl("pre", { className: "um-log", hidden: true });
  const record = [umapSessionLinks(stage)];
  if (stage.live?.text) record.push(umEl("pre", { className: "um-log" }, stage.live.text));
  if (stage.error) record.push(umEl("p", { className: "um-note err" }, stage.error));
  if (task.run) record.push(umEl("button", { type: "button", textContent: "수행 기록 보기", onclick: async () => {
    log.hidden = false;
    log.textContent = "불러오는 중…";
    try {
      const transcript = await umapRequest("workflow-transcript", { id: task.run.id, node });
      log.textContent = transcript.entries.map((entry) => entry.text).join("\n\n────────\n\n") || "기록이 없습니다.";
    } catch (error) { log.textContent = error.message; }
  } }), log);
  body.push(umapSection("세션·기록", ...record));
  if (stage.live?.askSession && asksOf(stage.live.askSession).length) {
    const host = umEl("div", { className: "um-asks" });
    host.innerHTML = asksOf(stage.live.askSession).map((request, index) => askCardHTML(request, index)).join("");
    bindWorkflowAskControls(host);
    body.splice(2, 0, umapSection("에이전트 질문", host));
  }
  openUmapDrawer("stage", taskId + ":" + node, task.title + " › " + stage.label, body);
  // 누른 칩(하네스·루프)·메뉴(수행 기록)에 맞는 칸으로 옮겨 첫 입력에 포커스를 둔다.
  const prefix = { harness: "하네스", loop: "루프", log: "세션" }[focus];
  const section = prefix && [...$("umap-drawer-body").querySelectorAll(".um-dsec")].find((el) => el.querySelector("h3")?.textContent.startsWith(prefix));
  if (section) {
    section.scrollIntoView({ block: "start" });
    section.classList.add("um-focus");
    section.querySelector(focus === "log" ? "button" : "input, textarea")?.focus({ preventScroll: true });
    if (focus === "log") section.querySelector("button")?.click();
  }
}

function openTaskDrawer(taskId) {
  const task = umapTaskById(taskId), project = umapProjectOf(taskId), busy = umapTaskBusy(task);
  const save = (patch) => umapSaveTask(taskId, patch);
  const options = umapFlowOptions(project).map((item) => [item.value, item.group + " · " + item.name]);
  const current = task.workflow && (UM.workflows.get(project) || []).some(({ id }) => id === task.workflow.id) ? "flow:" + task.workflow.id : "";
  if (current && !options.some(([value]) => value === current)) options.unshift([current, "지금 · " + task.workflow.name]);
  const body = [
    umEl("p", { className: "um-dstate" }, (TASK_STATUS[task.status]?.label || task.status) + (task.run ? " · 최근 실행 " + (UMAP_STAGE_STATE[task.run.status] || task.run.status) + " · " + ago(task.run.updated) : " · 아직 실행 전")),
    umapSection("Task", umapField("제목", task.title, (title) => title ? save({ title }) : Promise.reject(new Error("제목을 비울 수 없습니다.")), { disabled: busy }),
      umapField("본문", task.instruction, (instruction) => save({ instruction }), { multiline: true, rows: 8, disabled: busy,
        hint: "'완료 조건:'으로 시작하는 줄을 쓰면 기본 완료 조건 대신 그 내용을 씁니다." })),
    umapSection("한도·예산",
      umapField("시간 한도(분)", task.timeoutSet ? String(Math.round(task.timeoutMs / 60000)) : "", (value) => save({ timeoutMs: value === "" ? null : Math.round(Number(value)) * 60000 }),
        { type: "number", min: 1, max: 60, placeholder: "기본 " + Math.round(task.timeoutMs / 60000), disabled: busy, hint: "비우면 기본값" }),
      umapField("예산($)", task.budgetSet ? (task.budgetCents / 100).toFixed(2) : "", (value) => save({ budgetCents: value === "" ? null : Math.round(Number(value) * 100) }),
        { type: "number", min: 0, max: 1000, step: 0.01, placeholder: "기본 " + umapDollars(task.budgetCents), disabled: busy, hint: "비우면 기본값" })),
    umapSection("Workflow", umapSelectField("이 Task 의 Workflow", options, current, (value) => {
      if (value.startsWith("preset:")) return save({ template: value.slice(7) });
      const flow = (UM.workflows.get(project) || []).find(({ id }) => id === value.slice(5));
      return save({ workflow: flow.id, version: flow.version });
    }, busy ? "실행이 끝난 뒤 바꿀 수 있습니다." : "단계는 맵에서 Task ⋯ > Workflow 편집으로 고칩니다.")),
  ];
  if (task.run?.error) body.push(umEl("p", { className: "um-note err" }, task.run.error));
  openUmapDrawer("task", taskId, task.title, body);
}

function openProjectDrawer(project) {
  const aside = umEl("aside", { id: "unified-project-context", className: "um-context" });
  openUmapDrawer("project", project.id, project.name + " · 프로젝트 문서", [aside], true);
  window.UnifiedProjectContext?.show(project.id);
}

function openHelpDrawer() {
  const rows = [["빈 곳 끌기 · 휠", "맵 이동"], ["Ctrl+휠 · + −", "확대·축소"], ["0 · 1", "전체 보기 · 100%"], ["카드 끌기", "그 카드만 옮겨 두기(저장) · ⋯ > 자동 배치로 되돌리기"],
    ["세션 두 번 누르기 · 열기", "세션 전체 화면(Esc · 맵으로 = 같은 자리로 돌아오기)"], ["단계 · 칩 누르기", "서랍에서 고치기(이 Task만 · 템플릿)"],
    ["Alt+T", "＋ Task 한 줄"], ["Alt+I", "개입 필요 항목으로 이동"], ["Alt+L", "라이브러리"], ["Alt+N", "＋ 세션"], ["Esc", "서랍·편집·한 줄 닫기"]];
  openUmapDrawer("help", "help", "단축키와 조작", [umEl("table", { className: "um-help" }, ...rows.map(([key, text]) => umEl("tr", {}, umEl("th", {}, key), umEl("td", {}, text))))]);
}
