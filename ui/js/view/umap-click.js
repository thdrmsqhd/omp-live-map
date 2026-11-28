/* omp-live-map · view · 관제 벽의 누르기: 타일 머리(＋ Task·⋯·벽으로·상태 이름·예산), Task(제목 제자리 고치기·▶·⋯·서랍), 단계(이름·루프 숫자·모델·검증 명령·승인 안내
   제자리 고치기, 하네스 칩·⋯ = 단계 설정 서랍, 승인/반려, 편집 ＋), 에이전트 카드·합친 단계 카드(제목·빈 곳 = 활동 서랍, 카운터·한 일 줄 → diff·대화 자리,
   두 번 누르기 = 세션 열기). 접기·펼치기는 없다. */

async function umapClick(event) {
  const target = event.target;
  const action = target.closest("[data-um]")?.dataset.um;
  const card = target.closest(".um-card");
  const band = umapBandOf(target.closest("[data-band], .um-card, .um-add-line") || target);
  if (band) UM.current = band.key;
  const taskId = card?.dataset.task, node = card?.dataset.node;
  // 에이전트 카드의 세션 = data-node, 합친 단계 카드의 세션 = data-session(data-node 는 단계 id).
  const session = card?.dataset.session || (card?.classList.contains("um-agent") ? node : "");
  const button = target.closest("[data-um]");
  switch (action) {
    case "add-task": return umapOpenAdd(band.key);
    case "band-menu": return umapBandMenu(button, band);
    case "status": return umapStatusMenu(button, band, button.dataset.status);
    case "status-add": return umapAddStatus(band.project.id);
    case "period": return umapPeriodEdit(button, band.project.id);
    case "budget": return umapBudgetEdit(button, band.project.id);
    case "run": return umapRunTask(umapTaskById(taskId)).then((run) => run && umapToast("실행을 시작했습니다 · 단계 아래에 세션이 이어집니다."));
    case "task-menu": return umapTaskMenu(button, taskId);
    case "edit-scope": UM.edit.scope = button.dataset.scope; UM.edit.status = button.dataset.scope === "template" ? "다음 변경부터 템플릿에 저장합니다" : "다음 변경부터 이 Task 사본에 저장합니다"; return paintUmap(true);
    case "edit-done": return umapEndEdit();
    case "wall": return umapLeaveFocus();
    case "insert": return umapInsertMenu(button, Number(button.dataset.index));
    case "harness": return openStageDrawer(taskId, node, "harness");
    case "loop": return openStageDrawer(taskId, node, "loop");
    case "stage": return openStageDrawer(taskId, node, "stage");
    case "stage-label": case "loop-attempts": case "loop-timeout": case "check": case "approval-prompt": return umapStageInline(button, taskId, node, action);
    case "model": return umapStageModelMenu(button, taskId, node);
    case "task-title": return umapTaskTitleEdit(button, taskId);
    case "agent": return openAgentDrawer(session, "head");
    case "stage-menu": return UM.edit?.task === taskId ? umapEditStageMenu(button, taskId, node) : umapStageMenu(button, taskId, node);
    case "approve": {
      const task = umapTaskById(taskId);
      button.disabled = true;
      return umapDecide(task.run.id, node, "approved").then(() => umapToast("승인했습니다 · 다음 단계로 진행합니다."));
    }
    case "reject": {
      const task = umapTaskById(taskId);
      return inlineEdit(button, { value: "", label: "반려 이유", placeholder: "반려 이유 · Enter",
        onSave: (reason) => reason ? umapDecide(task.run.id, node, "rejected", reason).then(() => umapToast("반려했습니다.")) : undefined });
    }
    case "open": return umapOpenSession(session);
    case "act-edits": return openAgentDrawer(session, "edits");
    case "act-cmds": return openAgentDrawer(session, "cmds");
    case "act-reads": return openAgentDrawer(session, "reads");
    case "act-item": {
      const row = target.closest("[data-um]");
      return row.dataset.file ? openAgentDrawer(session, "edits", { file: row.dataset.file, at: Number(row.dataset.ts) })
        : openAgentDrawer(session, "talk", { at: Number(row.dataset.ts) });
    }
    default: break;
  }
  if (!card || target.closest("button, input, select, textarea")) return;
  if (card.classList.contains("um-task")) return openTaskDrawer(taskId);
  // 에이전트 카드·합친 단계 카드: 한 번 누르기 = 활동 서랍, 두 번 누르기 = 세션 전체 화면. 세션 없는 단계 = 단계 설정 서랍.
  if (session) {
    if (event.detail >= 2) { closeUmapDrawer(); return umapOpenSession(session); }
    return openAgentDrawer(session, "head");
  }
  if (card.classList.contains("um-stage")) return openStageDrawer(taskId, node, "stage");
}

// 단계 글자 제자리 고치기(Enter·포커스 이동 = 저장, Esc = 취소). 저장 범위는 그 Task 의 범위(단계 설정 서랍의 칩, 기본 이 Task만).
function umapStageInline(anchor, taskId, node, what) {
  const task = umapTaskById(taskId), stage = task?.stages.find(({ id }) => id === node);
  if (!stage) return;
  const save = (patch) => umapEditStage(taskId, node, umapScopeOf(taskId), patch).then(() => umapToast("‘" + stage.label + "’ 저장 · " + umapScopeName(umapScopeOf(taskId))));
  const minutes = (value) => { const n = Math.round(Number(value)); if (!(n >= 1 && n <= 60)) throw new Error("시간 한도는 1~60분입니다."); return n; };
  const edits = {
    "stage-label": { value: stage.label, label: "단계 이름", onSave: (label) => label ? save({ stage: { label } }) : undefined },
    "loop-attempts": { value: String(stage.loop?.attempts ?? ""), type: "number", min: 1, max: 8, label: "최대 시도(회)",
      onSave: (value) => { const n = Math.round(Number(value)); if (!(n >= 1 && n <= 8)) throw new Error("최대 시도는 1~8회입니다."); return save({ loop: { attempts: n } }); } },
    "loop-timeout": { value: String(Math.round((stage.loop?.timeoutMs || 0) / 60000)), type: "number", min: 1, max: 60, label: "시간 한도(분)",
      onSave: (value) => save({ loop: { timeoutMs: minutes(value) * 60000 } }) },
    check: { value: umapCommandText(stage.check), label: "검증 명령", onSave: (text) => text ? save({ stage: { check: umapParseCommand(text) } }) : undefined },
    "approval-prompt": { value: stage.prompt || "", multiline: true, label: "승인 안내", onSave: (prompt) => save({ stage: { prompt } }) },
  };
  return inlineEdit(anchor, edits[what]);
}
const umapScopeName = (scope) => scope === "template" ? "템플릿 새 버전" : "이 Task만";
// 모델 칩: 같은 범위의 모델 정의 목록에서 고른다(제자리 메뉴).
async function umapStageModelMenu(anchor, taskId, node) {
  const task = umapTaskById(taskId), stage = task?.stages.find(({ id }) => id === node);
  if (!stage?.harness) return;
  const options = await umapModelOptions(umapProjectOf(taskId), stage.harness);
  inlineMenu(anchor, options.map(([id, name]) => ({ label: (id === stage.harness.model?.id ? "✓ " : "") + name,
    run: () => void umapEditStage(taskId, node, umapScopeOf(taskId), { harness: { model: id } }).then(() => umapToast("모델 저장 · " + umapScopeName(umapScopeOf(taskId))), (error) => umapToast(error.message)) })));
}
function umapTaskTitleEdit(anchor, taskId) {
  const task = umapTaskById(taskId);
  if (!task || umapTaskBusy(task)) return;
  inlineEdit(anchor, { value: task.title, label: "Task 제목", onSave: (title) => { if (!title) throw new Error("제목을 비울 수 없습니다."); return umapSaveTask(taskId, { title }); } });
}

function umapResetItem(key) { umapResetManual(key); paintUmap(true); }
// 자동 배치로 되돌리기(벽 전체 · 타일 하나): 지우기 전 배치를 떠 두고 토스트의 '되돌리기'로 그대로 되살린다.
function umapResetLayout(band = "") {
  const before = umapLayoutSnapshot();
  umapResetAllManual(band || undefined);
  if (!band) umapWallReset();
  paintUmap(true);
  umapToast(band ? "이 타일의 카드를 자동 배치로 되돌렸습니다." : "카드·타일 순서·타일 크기를 모두 자동 배치로 되돌렸습니다.",
    { label: "되돌리기", run: () => { umapRestoreLayout(before); paintUmap(true); umapToast("손으로 맞춘 배치를 되살렸습니다."); } });
}
// 맵 도구 막대 ⋯: 벽 전체를 자동 배치로 되돌리기(되돌리기 토스트) · 단축키.
function umapWallMenu(anchor) {
  inlineMenu(anchor, [
    { label: "자동 배치로 되돌리기", disabled: !umapHasManualLayout(), title: umapHasManualLayout() ? "옮긴 카드·타일 순서·타일 크기를 모두 자동으로(토스트에서 되돌리기)" : "손으로 맞춘 배치가 없습니다",
      run: () => umapResetLayout() },
    { label: "단축키와 조작 (?)", run: () => openHelpDrawer() },
  ]);
}

// 타일 ⋯: 앞·뒤로 옮기기(끌기와 같은 저장), 전체 화면, 크기 자동으로, 이 타일 카드 되돌리기, 프로젝트 문서·이름·보관.
function umapBandMenu(anchor, band) {
  const keys = UMAP_PACK?.order || UMAP_BANDS.map(({ key }) => key), index = keys.indexOf(band.key), project = band.project;
  const title = $("umap-items").querySelector(`[data-band="${CSS.escape(band.key)}"] .um-band-title`);
  const move = (delta) => { umapWallSetOrder(umapMoveStage(keys, band.key, index + delta)); paintUmap(true); };
  inlineMenu(anchor, [
    UM.focus === band.key ? { label: "관제 벽으로 (Esc)", run: () => umapLeaveFocus() } : { label: "전체 화면으로 보기 (머리 두 번 누르기)", run: () => umapEnterFocus(band.key) },
    { label: "앞으로 옮기기", disabled: index <= 0 || Boolean(UM.focus), run: () => move(-1) },
    { label: "뒤로 옮기기", disabled: index < 0 || index === keys.length - 1 || Boolean(UM.focus), run: () => move(1) },
    { label: "타일 크기 자동으로", disabled: !(band.key in UM.wall.sizes), title: "일하는 타일은 크게, 쉬는 타일은 한 줄로", run: () => { umapWallResetSize(band.key); paintUmap(true); } },
    { label: "이 타일 카드 자동 배치로 되돌리기", disabled: !umapHasManualLayout(band.key), run: () => umapResetLayout(band.key) },
    ...(project ? [
      { label: "프로젝트 문서", run: () => openProjectDrawer(project) },
      { label: "이름 바꾸기", run: () => inlineEdit(title, { value: project.name, label: "프로젝트 이름",
        onSave: async (name) => { if (!name) return; await umapRequest("projects/rename", {}, { id: project.id, name }); await umapRefresh(true); } }) },
      { label: "보관", title: "타일이 세션 폴더로 돌아갑니다. ＋ Task 로 다시 만들면 되살아납니다.", run: () => void umapRequest("projects/archive", {}, { id: project.id }).then(() => umapRefresh(true)) },
    ] : []),
  ]);
}

function umapStatusMenu(anchor, band, status) {
  const item = band.labels.find((entry) => entry.status === status);
  inlineMenu(anchor, [
    { label: "이름 바꾸기", run: () => inlineEdit(anchor, { value: item?.label ?? TASK_STATUS[status]?.label ?? status, label: "상태 이름",
      onSave: (label) => label ? umapRenameStatus(band.project.id, status, label) : undefined }) },
    { label: "이 상태 지우기", disabled: !item || item.builtin, title: item?.builtin ? "기본 상태는 실행과 이어져 있어 지울 수 없습니다" : "이 상태의 Task 는 Backlog 로 돌아갑니다",
      run: () => void umapRemoveStatus(band.project.id, status).catch((error) => umapToast(error.message)) },
  ]);
}
function umapPeriodEdit(anchor, project) {
  const entry = UM.metrics.get(project);
  inlineEdit(anchor, { value: String(entry?.days ?? 7), type: "number", min: 1, max: 90, label: "집계 기간(일)",
    onSave: (value) => { const days = Math.round(Number(value)); if (!(days >= 1 && days <= 90)) throw new Error("기간은 1~90일입니다."); return umapSavePeriod(project, days); } });
}
function umapBudgetEdit(anchor, project) {
  const entry = UM.metrics.get(project);
  inlineEdit(anchor, { value: entry?.budget ? (entry.budget.cap / 100).toFixed(2) : "", type: "number", min: 0, max: 10000, step: 0.01,
    label: "프로젝트 예산(달러)", placeholder: "비우면 제한 없음",
    onSave: (value) => umapSaveBudget(project, value === "" ? null : Math.round(Number(value) * 100), entry?.days ?? 7) });
}

function umapTaskMenu(anchor, taskId) {
  const task = umapTaskById(taskId), project = umapProjectOf(taskId), busy = umapTaskBusy(task);
  const band = UMAP_BANDS.find((item) => item.project?.id === project);
  const statuses = (band?.labels.length ? band.labels : Object.entries(TASK_STATUS).map(([status, meta]) => ({ status, label: meta.label })))
    .filter(({ status }) => !["running", "waiting_approval", "completed"].includes(status) && status !== task.status);
  const failed = task.stages.find(({ status }) => status === "failed");
  inlineMenu(anchor, [
    { label: "Workflow 편집", disabled: busy, title: busy ? "실행이 끝난 뒤 고칠 수 있습니다" : "단계 넣기·순서 바꾸기·지우기", run: () => umapBeginEdit(taskId) },
    { label: "내용·한도 고치기", run: () => openTaskDrawer(taskId) },
    ...(task.run && ["running", "queued", "waiting_approval", "paused", "interrupted"].includes(task.run.status) ? [{ label: "실행 취소", run: () => void umapRunAction(task.run.id, "cancel").catch((error) => umapToast(error.message)) }] : []),
    ...(failed && task.run?.status === "failed" ? [{ label: "‘" + failed.label + "’ 다시 시도", run: () => void umapRetry(task.run.id, failed.id).catch((error) => umapToast(error.message)) }] : []),
    ...statuses.map(({ status, label }) => ({ label: label + "(으)로 옮기기", disabled: busy, run: () => void umapMoveTask(taskId, status).catch((error) => umapToast(error.message)) })),
    { label: "자동 배치로 되돌리기", disabled: !umapIsManual(umapTaskKey(taskId)), run: () => umapResetItem(umapTaskKey(taskId)) },
  ]);
}
function umapStageMenu(anchor, taskId, node) {
  const key = umapStageKey(taskId, node), session = anchor.closest(".um-card")?.dataset.session;
  inlineMenu(anchor, [
    { label: "단계 설정 (지시·하네스·루프)", run: () => openStageDrawer(taskId, node, "stage") },
    ...(session ? [{ label: "활동 서랍", run: () => openAgentDrawer(session, "head") }, { label: "세션 열기 (전체 화면)", run: () => umapOpenSession(session) }] : []),
    { label: "수행 기록 보기", disabled: !umapTaskById(taskId)?.run, run: () => openStageDrawer(taskId, node, "log") },
    { label: "자동 배치로 되돌리기", disabled: !umapIsManual(key), run: () => umapResetItem(key) },
  ]);
}
function umapSessionMenu(card) {
  const key = card.dataset.key, id = card.dataset.node;
  inlineMenu(card.querySelector(".um-role") || card, [
    { label: "열기 (전체 화면)", run: () => umapOpenSession(id) },
    { label: "활동 서랍", run: () => openAgentDrawer(id, "head") },
    { label: "자동 배치로 되돌리기", disabled: !umapIsManual(key), run: () => umapResetItem(key) },
  ]);
}

// 주소 ?run=<id>(예전 실행 링크): 그 실행의 Task 카드가 보이게 그 타일을 옮기고 스크롤한다.
function umapRevealRun(runId) {
  for (const band of UMAP_BANDS) for (const task of band.tasks) {
    if (task.run?.id !== runId) continue;
    const box = UMAP_LAYOUT.boxes[umapTaskKey(task.id)];
    if (box) umapReveal(box, true);
    return;
  }
}

// 위쪽 '개입 필요 N': 누를 때마다 다음 항목(승인 대기 단계 → 실패·보류 → 답을 기다리는 세션)으로 — 그 타일이 화면에 오게 벽을 옮기고,
// 타일 본문을 그 단계·카드까지 스크롤해 반짝인다. 다른 프로젝트를 전체 화면으로 보고 있었으면 벽으로 돌아온다.
let umapAttentionAt = 0;
function umapJumpAttention() {
  if (mapMode !== "map") setMapMode("map");
  const list = umapAttention(UMAP_BANDS);
  if (!list.length) return umapToast("지금 개입이 필요한 항목이 없습니다.");
  const item = list[umapAttentionAt++ % list.length];
  if (UM.focus && UM.focus !== item.band) umapLeaveFocus();
  UM.current = item.band;
  const box = UMAP_LAYOUT.boxes[item.key];
  if (box) umapReveal(box, true);
  umapToast(item.label);
}
