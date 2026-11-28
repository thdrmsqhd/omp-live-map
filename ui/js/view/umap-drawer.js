/* omp-live-map · view · 맵 오른쪽 서랍. 단계·하네스·루프·Task 설정은 '이름 · 값' 한 줄씩(umapProp)이고, 값 글자를 눌러 그 자리에서 고친다
   (inlineEdit: Enter·포커스 이동 = 저장, Esc = 취소 · 고를 값은 제자리 메뉴). 입력 칸을 쌓은 폼·저장 단추는 없다.
   저장 범위 칩: '이 Task만'(기본, Task 전용 사본) ⇄ '템플릿'(원본의 새 버전) — 카드에서 제자리로 고칠 때도 같은 범위. 서버: tasks/stage(engineering/task-local.js). */

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

// 설정 한 줄: 이름 · 값(글자). 값을 누르면 그 자리에서 고친다(inlineEdit: Enter·포커스 이동 = 저장, Esc = 취소) — 입력 칸을 늘어놓은 폼·저장 단추는 없다.
// edit: { save(value), multiline, type, min, max, step, placeholder, options: [[id, 이름]] | async () => [[id, 이름]], disabled(이유), show(value) → 보일 글자 }
function umapProp(label, value, edit = {}) {
  const show = (v) => (edit.show ? edit.show(v) : String(v ?? "")) || edit.empty || "—";
  const button = umEl("button", { type: "button", className: "um-prop-v" + (edit.multiline ? " multi" : ""), textContent: show(value),
    disabled: Boolean(edit.disabled), title: edit.disabled || (edit.options ? "눌러서 고르기" : "눌러서 고치기" + (edit.multiline ? " · Shift+Enter 줄바꿈" : "")) });
  const note = umEl("small", { className: "um-note" });
  let current = value;
  const done = (next) => { current = next; button.textContent = show(next); note.textContent = "저장됨"; note.classList.remove("err"); };
  const fail = (error) => { note.textContent = error.message; note.classList.add("err"); };
  button.onclick = async () => {
    if (!edit.save) return;
    if (edit.options) {
      const options = typeof edit.options === "function" ? await edit.options() : edit.options;
      inlineMenu(button, options.map(([id, name]) => ({ label: (id === current ? "✓ " : "") + name,
        run: () => { note.textContent = "저장 중…"; void Promise.resolve(edit.save(id)).then(() => done(id), fail); } })));
      return;
    }
    inlineEdit(button, { value: String(current ?? ""), label, type: edit.type, min: edit.min, max: edit.max, step: edit.step, placeholder: edit.placeholder, multiline: edit.multiline,
      onSave: async (next) => { note.textContent = "저장 중…"; try { await edit.save(next); done(next); } catch (error) { fail(error); } } });
  };
  return umEl("div", { className: "um-prop" }, umEl("span", { className: "um-prop-k" }, label), umEl("div", { className: "um-prop-cell" }, button, note));
}
const umapSheet = (...rows) => umEl("div", { className: "um-sheet" }, ...rows);
const umapNumber = (min, max, what) => (value) => { const n = Number(value); if (!(Number.isFinite(n) && n >= min && n <= max)) throw new Error(what + "은(는) " + min + "~" + max + " 사이입니다."); return n; };
// 하네스가 쓸 수 있는 모델 = 같은 범위(개인·팀·프로젝트)의 모델 정의.
async function umapModelOptions(project, harness) {
  const definitions = await umapDefinitions(project).catch(() => []);
  const owner = definitions.find(({ id }) => id === harness.id);
  const options = definitions.filter((item) => item.kind === "model" && (!owner || (item.scope === owner.scope && item.project === owner.project && item.team === owner.team)))
    .map((model) => [model.id, model.name + " · " + model.payload.model]);
  if (harness.model && !options.some(([id]) => id === harness.model.id)) options.unshift([harness.model.id, harness.model.name]);
  return options;
}
const umapSection = (title, ...children) => umEl("section", { className: "um-dsec" }, umEl("h3", {}, title), ...children);
const umapParseCommand = (text) => { const [command, ...args] = String(text).trim().split(/\s+/).filter(Boolean); return { command, args, code: 0 }; };
const umapCommandText = (check) => check ? [check.command, ...(check.args || [])].join(" ") : "";

// 저장 범위 칩: 누를 때마다 '이 Task만'(Task 전용 사본) ⇄ '템플릿'(원본의 새 버전). 카드에서 제자리로 고칠 때도 이 범위를 쓴다(UM.stageScope).
function umapScopeChip(taskId, flowName) {
  const note = umEl("small", { className: "um-muted" });
  const chip = umEl("button", { type: "button", className: "um-chip scope" });
  const paint = () => {
    const scope = umapScopeOf(taskId);
    chip.textContent = "저장 · " + umapScopeName(scope);
    chip.setAttribute("aria-pressed", String(scope === "template"));
    chip.title = "눌러서 " + (scope === "task" ? "템플릿" : "이 Task만") + "으로 바꾸기";
    note.textContent = scope === "task" ? "같은 Workflow 를 쓰는 다른 Task 는 그대로입니다." : "‘" + flowName + "’ 새 버전으로 저장하고 이 Task 를 그 버전에 고정합니다.";
  };
  chip.onclick = () => { UM.stageScope.set(taskId, umapScopeOf(taskId) === "task" ? "template" : "task"); paint(); };
  paint();
  return umEl("div", { className: "um-scope" }, chip, note);
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
  const project = umapProjectOf(taskId);
  const save = (patch) => umapEditStage(taskId, node, umapScopeOf(taskId), patch);
  const flowName = (task.workflow?.name || "").replace(/ · Task [0-9a-f-]{8}$/, "");
  const body = [umapScopeChip(taskId, flowName)];
  body.push(umEl("p", { className: "um-dstate s-" + stage.status }, (UMAP_STAGE_STATE[stage.status] || stage.status) + " · " + (UMAP_KIND[stage.type] || stage.type)));
  if (stage.status === "waiting_approval" && task.run) {
    body.push(umEl("div", { className: "um-approve wide" }, umEl("p", {}, stage.waiting?.prompt || stage.prompt || ""),
      umEl("button", { type: "button", className: "go", textContent: "승인", onclick: () => void umapDecide(task.run.id, node, "approved").then(closeUmapDrawer, (error) => umapToast(error.message)) }),
      umEl("button", { type: "button", className: "stop", textContent: "반려…", onclick: (event) => inlineEdit(event.currentTarget, { value: "", label: "반려 이유", placeholder: "반려 이유 · Enter",
        onSave: (reason) => reason ? umapDecide(task.run.id, node, "rejected", reason).then(closeUmapDrawer) : undefined }) })));
  }
  const rows = [umapProp("이름", stage.label, { save: (label) => label ? save({ stage: { label } }) : Promise.reject(new Error("이름을 비울 수 없습니다.")) })];
  if (stage.type === "agent" || stage.type === "loop") rows.push(umapProp("단계 지시", stage.instruction, { multiline: true, empty: "(없음 · 눌러서 쓰기)", save: (instruction) => save({ stage: { instruction } }) }));
  if (stage.type === "approval") rows.push(umapProp("승인 안내", stage.prompt, { multiline: true, empty: "(없음 · 눌러서 쓰기)", save: (prompt) => save({ stage: { prompt } }) }));
  if (stage.type === "command") rows.push(umapProp("검증 명령", umapCommandText(stage.check), { save: (text) => save({ stage: { check: umapParseCommand(text) } }) }));
  body.push(umapSection("단계", umapSheet(...rows)));
  if (stage.harness) {
    body.push(umapSection("하네스 · " + stage.harness.name, umEl("p", { className: "um-muted" }, (stage.harness.adapter === "omp" ? "OMP" : "Claude Code") + " · v" + stage.harness.version + " · " + ({ personal: "개인", team: "팀", project: "프로젝트" }[stage.harness.scope] || "")),
      umapSheet(umapProp("역할", stage.harness.role, { save: (role) => save({ harness: { role } }) }),
        umapProp("하네스 지시", stage.harness.instructions, { multiline: true, empty: "(없음 · 눌러서 쓰기)", save: (instructions) => save({ harness: { instructions } }) }),
        umapProp("모델", stage.harness.model?.id, { options: () => umapModelOptions(project, stage.harness), show: (id) => (id === stage.harness.model?.id ? stage.harness.model?.name : id) || "",
          save: (model) => save({ harness: { model } }) }))));
  }
  if (stage.loop) {
    body.push(umapSection("루프 · " + stage.loop.name, umapSheet(
      umapProp("최대 시도", stage.loop.attempts, { type: "number", min: 1, max: 8, show: (v) => v + "회", save: (v) => save({ loop: { attempts: Math.round(umapNumber(1, 8, "최대 시도")(v)) } }) }),
      umapProp("시간 한도", Math.round(stage.loop.timeoutMs / 60000), { type: "number", min: 1, max: 60, show: (v) => v + "분", save: (v) => save({ loop: { timeoutMs: Math.round(umapNumber(1, 60, "시간 한도")(v)) * 60000 } }) }),
      umapProp("예산", (stage.loop.budgetCents / 100).toFixed(2), { type: "number", min: 0, max: 1000, step: 0.01, show: (v) => "$" + Number(v).toFixed(2), save: (v) => save({ loop: { budgetCents: Math.round(umapNumber(0, 1000, "예산")(v) * 100) } }) }),
      umapProp("검증 명령", stage.loop.checks.map(umapCommandText).join("\n"), { multiline: true, save: (text) => save({ loop: { checks: text.split(/\n+/).filter(Boolean).map(umapParseCommand) } }) }))));
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
  // 누른 칩(하네스·루프)·메뉴(수행 기록)에 맞는 칸으로 옮긴다.
  const prefix = { harness: "하네스", loop: "루프", log: "세션" }[focus];
  const section = prefix && [...$("umap-drawer-body").querySelectorAll(".um-dsec")].find((el) => el.querySelector("h3")?.textContent.startsWith(prefix));
  if (section) {
    section.scrollIntoView({ block: "start" });
    section.classList.add("um-focus");
    section.querySelector(".um-prop-v, button")?.focus({ preventScroll: true });
    if (focus === "log") [...section.querySelectorAll("button")].find((el) => el.textContent === "수행 기록 보기")?.click();
  }
}

function openTaskDrawer(taskId) {
  const task = umapTaskById(taskId), project = umapProjectOf(taskId), busy = umapTaskBusy(task);
  const save = (patch) => umapSaveTask(taskId, patch);
  const locked = busy ? "실행 중에는 고칠 수 없습니다 · 끝난 뒤 고치세요" : "";
  const options = umapFlowOptions(project).map((item) => [item.value, item.group + " · " + item.name]);
  const current = task.workflow && (UM.workflows.get(project) || []).some(({ id }) => id === task.workflow.id) ? "flow:" + task.workflow.id : "";
  if (current && !options.some(([value]) => value === current)) options.unshift([current, "지금 · " + task.workflow.name]);
  const minutes = Math.round(task.timeoutMs / 60000);
  const body = [
    umEl("p", { className: "um-dstate" }, (TASK_STATUS[task.status]?.label || task.status) + (task.run ? " · 최근 실행 " + (UMAP_STAGE_STATE[task.run.status] || task.run.status) + " · " + ago(task.run.updated) : " · 아직 실행 전")),
    umapSection("Task", umapSheet(
      umapProp("제목", task.title, { disabled: locked, save: (title) => title ? save({ title }) : Promise.reject(new Error("제목을 비울 수 없습니다.")) }),
      umapProp("본문", task.instruction, { disabled: locked, multiline: true, empty: "(없음 · 눌러서 쓰기)", save: (instruction) => save({ instruction }) }),
      umapProp("시간 한도", task.timeoutSet ? minutes : "", { disabled: locked, type: "number", min: 1, max: 60, placeholder: "비우면 기본 " + minutes + "분",
        show: (v) => (v === "" || v === null ? "기본 " + minutes + "분" : v + "분"), save: (v) => save({ timeoutMs: v === "" ? null : Math.round(umapNumber(1, 60, "시간 한도")(v)) * 60000 }) }),
      umapProp("예산", task.budgetSet ? (task.budgetCents / 100).toFixed(2) : "", { disabled: locked, type: "number", min: 0, max: 1000, step: 0.01, placeholder: "비우면 기본 " + umapDollars(task.budgetCents),
        show: (v) => (v === "" || v === null ? "기본 " + umapDollars(task.budgetCents) : "$" + Number(v).toFixed(2)), save: (v) => save({ budgetCents: v === "" ? null : Math.round(umapNumber(0, 1000, "예산")(v) * 100) }) }),
      umapProp("Workflow", current, { disabled: locked, options, show: (value) => (options.find(([id]) => id === value)?.[1] || task.workflow?.name || "없음"),
        save: (value) => {
          if (value.startsWith("preset:")) return save({ template: value.slice(7) });
          const flow = (UM.workflows.get(project) || []).find(({ id }) => id === value.slice(5));
          return save({ workflow: flow.id, version: flow.version });
        } })),
      umEl("small", { className: "um-muted" }, "본문에 '완료 조건:'으로 시작하는 줄을 쓰면 기본 완료 조건 대신 그 내용을 씁니다. 단계는 맵에서 Task ⋯ > Workflow 편집으로 고칩니다.")),
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
  const rows = [["타일 위 휠 · 빈 곳 끌기", "그 타일만 스크롤"], ["타일 사이 휠 · 끌기", "관제 벽 이동"], ["타일 머리 끌기", "타일 순서 바꾸기(저장)"],
    ["타일 오른쪽 아래 모서리 끌기", "타일 크기(격자 칸에 맞춤, 저장) · ⋯ > 타일 크기 자동으로"], ["타일 머리 두 번 누르기 · Enter", "그 프로젝트 전체 화면(Esc = 같은 자리의 벽으로)"],
    ["0 · 1 · Ctrl+휠", "벽 전체 보기 · 100% · 확대·축소"], ["카드 끌기", "그 카드만 타일 안에 옮겨 두기(저장) · 카드 ⋯ · 맵 ⋯ > 자동 배치로 되돌리기(토스트에서 되돌리기)"],
    ["세션 두 번 누르기 · 열기", "세션 전체 화면(Esc · 맵으로 = 같은 자리로 돌아오기)"], ["단계 이름 · 루프 숫자 · 모델 누르기", "그 자리에서 고치기(Enter 저장 · Esc 취소)"],
    ["하네스 칩 · 단계 ⋯ > 단계 설정", "지시·역할·한도를 글자 그대로 눌러 고치기(저장 범위 칩: 이 Task만 ⇄ 템플릿)"], ["Tab · Enter", "카드 제목 단추로 활동 서랍 열기"],
    ["Task ⋯ > Workflow 편집", "그 프로젝트 전체 화면에서 단계 넣기·순서·지우기(끝내면 벽으로)"],
    ["Alt+T", "＋ Task 한 줄"], ["Alt+I", "개입 필요 항목으로 이동(타일 스크롤 + 반짝임)"], ["Alt+L", "라이브러리"], ["Alt+N", "＋ 세션"], ["Esc", "서랍·편집·한 줄 닫기 · 전체 화면에서 벽으로"]];
  openUmapDrawer("help", "help", "단축키와 조작", [umEl("table", { className: "um-help" }, ...rows.map(([key, text]) => umEl("tr", {}, umEl("th", {}, key), umEl("td", {}, text))))]);
}
