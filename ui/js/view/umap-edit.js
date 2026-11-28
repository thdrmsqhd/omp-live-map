/* omp-live-map · view · 맵 안의 두 편집 줄.
   1) '＋ Task' 한 줄: 띠 머리의 ＋ Task(또는 위쪽 ＋ 새 실행)가 그 띠 맨 위에 글 + Workflow 칩 한 줄을 연다. Enter = 만들기(새 실행이면 만들고 실행), Esc = 닫기.
   2) Workflow 편집: Task ⋯ > 'Workflow 편집'이 그 Task 의 단계 줄만 편집 상태로 둔다(나머지는 흐리게). 단계 사이 ＋ = 넣기,
      단계를 끌면 순서 바꾸기, 단계 ⋯ = 지우기. 바꿀 때마다 저장한다(범위: 이 Task만 · 템플릿). */

function umapAddLineHTML(band, box) {
  const project = band.project?.id;
  const options = project ? umapFlowOptions(project) : UM.presets.map((preset) => ({ value: "preset:" + preset.id, name: preset.name, title: preset.summary, group: "템플릿" }));
  const chosen = UM.adding.flow || (project ? umapLastFlow(project) : "preset:feature");
  const groups = [...new Set(options.map(({ group }) => group))].map((group) => `<optgroup label="${esc(group)}">${options.filter((item) => item.group === group)
    .map((item) => `<option value="${esc(item.value)}" title="${esc(item.title || "")}"${item.value === chosen ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</optgroup>`).join("");
  return `<div class="um-add-line${UM.adding.run ? " run" : ""}" data-key="${esc(box.key)}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">
    <input class="um-add-text" maxlength="12000" spellcheck="false" aria-label="새 Task" placeholder="${UM.adding.run ? "무엇을 할까요? Enter = 만들고 바로 실행" : "무엇을 할까요? Enter = Task 만들기"}" value="${esc(UM.adding.text || "")}">
    <select class="um-flow-select" aria-label="Workflow">${groups}</select><small>${esc(UM.adding.status || "Esc 닫기")}</small></div>`;
}

// ＋ Task 한 줄 열기. bandKey 가 없으면 지금(마지막으로 만진) 띠 → 가장 최근 프로젝트 띠.
function umapOpenAdd(bandKey, { run = false } = {}) {
  const key = bandKey || umapCurrentBand();
  if (!key) return;
  UM.adding = { band: key, run, focus: true, text: "" };
  UM.current = key;
  paintUmap(true);
  const box = UMAP_LAYOUT?.boxes["add:" + key];
  if (box) umapReveal(box);
}
function umapCurrentBand() {
  const bands = UMAP_BANDS;
  if (UM.current && bands.some(({ key }) => key === UM.current)) return UM.current;
  const recent = bands.filter((band) => band.project).map((band) => ({ band, at: Math.max(0, ...band.tasks.map((task) => task.updated || 0), ...band.sessions.map((s) => s.lastTs || 0)) }))
    .sort((a, b) => b.at - a.at)[0];
  return recent?.band.key || bands[0]?.key || "";
}
function umapCloseAdd() { UM.adding = null; paintUmap(true); }

function bindUmapAddLine(items) {
  items.addEventListener("keydown", (event) => {
    const input = event.target.closest?.(".um-add-text");
    if (!input) return;
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); umapCloseAdd(); return; }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const text = input.value.trim(), adding = UM.adding;
    if (!text || input.disabled || !adding) return;
    const band = UMAP_BANDS.find(({ key }) => key === adding.band);
    const flow = input.parentElement.querySelector(".um-flow-select").value;
    input.disabled = true;
    adding.text = text;
    adding.status = adding.run ? "만들고 실행하는 중…" : "만드는 중…";
    input.nextElementSibling.nextElementSibling.textContent = adding.status;
    void umapCreateTask(band, text, flow, adding.run).then(() => {
      UM.adding = adding.run ? null : { ...adding, text: "", status: "만들었습니다 · 이어서 적거나 Esc", focus: true };
      if (UM.adding) UM.adding.band = band.project ? band.key : "project:" + (UM.projects.find((p) => monitorPath(p.root) === monitorPath(band.folder))?.id || "");
      paintUmap(true);
    }, (error) => { adding.status = error.message; input.disabled = false; paintUmap(true); });
  });
  items.addEventListener("change", (event) => {
    const select = event.target.closest?.(".um-flow-select");
    if (select && UM.adding) { UM.adding.flow = select.value; select.closest(".um-add-line").querySelector(".um-add-text").focus(); }
  });
  items.addEventListener("input", (event) => { if (event.target.closest?.(".um-add-text") && UM.adding) UM.adding.text = event.target.value; });
}

// 편집 중인 줄의 ＋: 맨 앞(Task 카드와 첫 단계 사이), 단계 사이, 맨 뒤.
function umapEditPlusHTML(task, layout) {
  const boxes = task.stages.map(({ id }) => layout.boxes[umapStageKey(task.id, id)]).filter(Boolean);
  const taskBox = layout.boxes[umapTaskKey(task.id)];
  const spots = [];
  const y = (boxes[0] || taskBox).y + UMAP.STAGE_H / 2 - 13;
  spots.push(!boxes.length ? UMAP.STAGE_X : boxes[0].x === UMAP.STAGE_X ? UMAP.PAD + UMAP.TASK_W + 6 : boxes[0].x - 32);
  for (const box of boxes) spots.push(box.x + box.w + UMAP.STAGE_GAP / 2 - 13);
  return spots.map((x, index) => `<button class="um-plus" data-um="insert" data-task="${esc(task.id)}" data-index="${index}" style="left:${x}px;top:${y}px" title="여기에 단계 넣기" aria-label="${index + 1}번째 자리에 단계 넣기">＋</button>`).join("");
}

async function umapInsertMenu(anchor, index) {
  const task = umapTaskById(UM.edit.task), project = umapProjectOf(task.id);
  let harnesses = [];
  try { harnesses = (await umapDefinitions(project)).filter(({ kind }) => kind === "harness"); } catch { /* 승인 단계만 넣을 수 있다 */ }
  const add = (spec, kind) => {
    const id = umapNewStageId(kind);
    UM.edit.added[id] = spec;
    void umapSaveEdit(umapInsertStage(UM.edit.ids, index, id));
  };
  inlineMenu(anchor, [
    { label: "승인 단계", title: "사람이 결과를 보고 승인·반려합니다", run: () => add({ type: "approval", label: "승인", prompt: "결과를 확인해 주세요." }, "approval") },
    ...harnesses.slice(0, 14).map((harness) => ({ label: "에이전트 · " + harness.name, title: harness.payload.role,
      run: () => add({ type: "agent", label: harness.name.replace(/^기본 · /, "").replace(/ · Task [0-9a-f-]{8}$/, ""), definition: harness.id, instruction: "이 단계에서 할 일을 적어 주세요." }, "agent") })),
  ]);
}
function umapEditStageMenu(anchor, taskId, node) {
  inlineMenu(anchor, [
    { label: "단계 지우기", disabled: UM.edit.ids.length <= 1, title: "앞뒤 단계는 바로 이어집니다", run: () => void umapSaveEdit(umapRemoveStage(UM.edit.ids, node)) },
    { label: "단계 고치기…", run: () => openStageDrawer(taskId, node, "stage") },
  ]);
}
// 편집 중 단계 끌기가 끝나면 놓은 x 로 새 자리를 정한다(옮긴 자리로 저장하지 않는다).
function umapDropStage(taskId, node, worldX) {
  // 단계 칸 폭은 그 아래 에이전트 나무만큼 달라서 실제 칸 위치로 자리를 찾는다.
  const task = umapTaskById(taskId);
  const xs = (task?.stages || []).map(({ id }) => UMAP_LAYOUT?.boxes[umapStageKey(taskId, id)]?.x).filter(Number.isFinite);
  const index = umapDropIndex(worldX, UM.edit.ids.length, xs.length === UM.edit.ids.length ? xs : undefined);
  const next = umapMoveStage(UM.edit.ids, node, index);
  if (next.join() !== UM.edit.ids.join()) void umapSaveEdit(next); else paintUmap(true);
}
