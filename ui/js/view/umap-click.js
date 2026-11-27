/* omp-live-map · view · 한 맵의 누르기: 띠 머리(접기·＋ Task·⋯·상태 이름·예산), Task(▶·⋯·서랍), 단계(칩·서랍·승인/반려·편집 ＋), 세션(펼치기·열기). */

async function umapClick(event) {
  const target = event.target;
  const action = target.closest("[data-um]")?.dataset.um;
  const card = target.closest(".um-card");
  const band = umapBandOf(target.closest("[data-band], .um-card, .um-add-line") || target);
  if (band) UM.current = band.key;
  const taskId = card?.dataset.task, node = card?.dataset.node;
  const button = target.closest("[data-um]");
  switch (action) {
    case "fold": umapToggleBand(band.key); return paintUmap(true);
    case "add-task": return umapOpenAdd(band.key);
    case "band-menu": return umapBandMenu(button, band);
    case "status": return umapStatusMenu(button, band, button.dataset.status);
    case "status-add": return umapAddStatus(band.project.id);
    case "period": return umapPeriodEdit(button, band.project.id);
    case "budget": return umapBudgetEdit(button, band.project.id);
    case "run": return umapRunTask(umapTaskById(taskId)).then((run) => run && umapToast("실행을 시작했습니다 · 단계 아래에 세션이 이어집니다."));
    case "task-menu": return umapTaskMenu(button, taskId);
    case "expand": umapToggleExpanded(umapTaskKey(taskId)); return paintUmap(true);
    case "edit-scope": UM.edit.scope = button.dataset.scope; UM.edit.status = button.dataset.scope === "template" ? "다음 변경부터 템플릿에 저장합니다" : "다음 변경부터 이 Task 사본에 저장합니다"; return paintUmap(true);
    case "edit-done": return umapStopEdit();
    case "insert": return umapInsertMenu(button, Number(button.dataset.index));
    case "harness": return openStageDrawer(taskId, node, "harness");
    case "loop": return openStageDrawer(taskId, node, "loop");
    case "stage": return openStageDrawer(taskId, node, "stage");
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
    case "open": return umapOpenSession(card.dataset.node);
    default: break;
  }
  if (!card || target.closest("button, input, select, textarea")) return;
  if (card.classList.contains("um-done")) { umapToggleExpanded(umapTaskKey(taskId)); return paintUmap(true); }
  if (card.classList.contains("um-task")) return openTaskDrawer(taskId);
  if (card.classList.contains("um-stage")) return openStageDrawer(taskId, node, "stage");
  // 세션: 두 번 누르기 = 전체 화면(칩을 펼치며 다시 그려도 두 번째 누르기의 detail 은 2다), 칩 한 번 누르기 = 카드로 펼치기.
  if (card.classList.contains("um-sess") && card.dataset.node) {
    if (event.detail >= 2) return umapOpenSession(card.dataset.node);
    if (card.classList.contains("chip")) { umapToggleExpanded(card.dataset.key); paintUmap(true); }
  }
}

function umapResetItem(key) { umapResetManual(key); paintUmap(true); }

function umapBandMenu(anchor, band) {
  const keys = UMAP_BANDS.map(({ key }) => key), index = keys.indexOf(band.key), project = band.project;
  const title = $("umap-items").querySelector(`[data-band="${CSS.escape(band.key)}"] .um-band-title`);
  inlineMenu(anchor, [
    { label: "위로 옮기기", disabled: index === 0, run: () => { umapMoveBand(band.key, -1, keys); paintUmap(true); } },
    { label: "아래로 옮기기", disabled: index === keys.length - 1, run: () => { umapMoveBand(band.key, 1, keys); paintUmap(true); } },
    { label: band.collapsed ? "펼치기" : "접기", run: () => { umapToggleBand(band.key); paintUmap(true); } },
    { label: "이 띠 자동 배치로 되돌리기", disabled: !Object.values(UM.manual).some((spot) => spot.band === band.key), run: () => { umapResetAllManual(band.key); paintUmap(true); } },
    ...(project ? [
      { label: "프로젝트 문서", run: () => openProjectDrawer(project) },
      { label: "이름 바꾸기", run: () => inlineEdit(title, { value: project.name, label: "프로젝트 이름",
        onSave: async (name) => { if (!name) return; await umapRequest("projects/rename", {}, { id: project.id, name }); await umapRefresh(true); } }) },
      { label: "보관", title: "띠가 세션 폴더로 돌아갑니다. ＋ Task 로 다시 만들면 되살아납니다.", run: () => void umapRequest("projects/archive", {}, { id: project.id }).then(() => umapRefresh(true)) },
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
    { label: "Workflow 편집", disabled: busy, title: busy ? "실행이 끝난 뒤 고칠 수 있습니다" : "단계 넣기·순서 바꾸기·지우기", run: () => umapStartEdit(taskId) },
    { label: "내용·한도 고치기", run: () => openTaskDrawer(taskId) },
    ...(task.run && ["running", "queued", "waiting_approval", "paused", "interrupted"].includes(task.run.status) ? [{ label: "실행 취소", run: () => void umapRunAction(task.run.id, "cancel").catch((error) => umapToast(error.message)) }] : []),
    ...(failed && task.run?.status === "failed" ? [{ label: "‘" + failed.label + "’ 다시 시도", run: () => void umapRetry(task.run.id, failed.id).catch((error) => umapToast(error.message)) }] : []),
    ...statuses.map(({ status, label }) => ({ label: label + "(으)로 옮기기", disabled: busy, run: () => void umapMoveTask(taskId, status).catch((error) => umapToast(error.message)) })),
    ...(task.status === "completed" && UM.expanded.has(umapTaskKey(taskId)) ? [{ label: "한 줄로 접기", run: () => { umapToggleExpanded(umapTaskKey(taskId)); paintUmap(true); } }] : []),
    { label: "자동 배치로 되돌리기", disabled: !umapIsManual(umapTaskKey(taskId)), run: () => umapResetItem(umapTaskKey(taskId)) },
  ]);
}
function umapStageMenu(anchor, taskId, node) {
  const key = umapStageKey(taskId, node);
  inlineMenu(anchor, [
    { label: "단계 고치기", run: () => openStageDrawer(taskId, node, "stage") },
    { label: "수행 기록 보기", disabled: !umapTaskById(taskId)?.run, run: () => openStageDrawer(taskId, node, "log") },
    { label: "자동 배치로 되돌리기", disabled: !umapIsManual(key), run: () => umapResetItem(key) },
  ]);
}
function umapSessionMenu(card) {
  const key = card.dataset.key, id = card.dataset.node;
  inlineMenu(card.querySelector(".um-sess-name") || card, [
    { label: "열기 (전체 화면)", run: () => umapOpenSession(id) },
    { label: UM.expanded.has(key) ? "칩으로 접기" : "카드로 펼치기", run: () => { umapToggleExpanded(key); paintUmap(true); } },
    { label: "자동 배치로 되돌리기", disabled: !umapIsManual(key), run: () => umapResetItem(key) },
  ]);
}

// 주소 ?run=<id>(예전 실행 링크): 그 실행의 Task 줄로 옮긴다.
function umapRevealRun(runId) {
  for (const band of UMAP_BANDS) for (const task of band.tasks) {
    if (task.run?.id !== runId) continue;
    if (task.collapsed) { umapToggleExpanded(umapTaskKey(task.id)); paintUmap(true); }
    const box = UMAP_LAYOUT.boxes[umapTaskKey(task.id)];
    if (box) umapReveal(box, true);
    return;
  }
}

// 위쪽 '개입 필요 N': 누를 때마다 다음 항목(승인 대기 단계 → 보류 Task → 답을 기다리는 세션)으로 옮긴다.
let umapAttentionAt = 0;
function umapJumpAttention() {
  if (mapMode !== "map") setMapMode("map");
  const list = umapAttention(UMAP_BANDS);
  if (!list.length) return umapToast("지금 개입이 필요한 항목이 없습니다.");
  const item = list[umapAttentionAt++ % list.length];
  if (UM.collapsed.has(item.band)) { umapToggleBand(item.band); paintUmap(true); }
  const box = UMAP_LAYOUT.boxes[item.key];
  if (box) umapReveal(box, true);
  umapToast(item.label);
}
