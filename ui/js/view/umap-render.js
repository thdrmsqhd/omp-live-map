/* omp-live-map · view · 한 맵 그리기: 프로젝트 띠(머리 한 줄 지표) · Task 카드 · Workflow 단계(하네스·루프 칩) · 단계 아래 에이전트 나무
   (에이전트 카드 + 서브에이전트 카드 가지, view/umap-agent.js). 접기·펼치기·의미 확대 없음: 끝난 Task 는 흐리게 다 그리고, 카드는 배율과 상관없이 같은 문장을 보여 준다.
   자동 배치는 model/task-map.js umapLayout, 데이터는 viewmodel/task-map.js umapBands. 입력·끌기는 view/umap-input.js. */

let UMAP_LAYOUT = null, UMAP_BANDS = [], umapPending = false, umapPaintAt = 0, umapTimer = 0;
const UMAP_KIND = { agent: "에이전트", loop: "루프", approval: "승인", command: "명령", subgraph: "하위 Workflow", condition: "조건", parallel: "병렬", join: "합류" };
const UMAP_STAGE_STATE = { pending: "대기", running: "실행 중", succeeded: "완료", failed: "실패", waiting_approval: "승인 대기", skipped: "건너뜀", interrupted: "중단" };
const umapDollars = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
const umapStatusLabel = (band, status) => band.labels.find((item) => item.status === status)?.label ?? TASK_STATUS[status]?.label ?? status;
const umapStatusColor = (status) => (TASK_STATUS[status] ?? { color: "#6f8296" }).color;
const umapMemoryLimit = () => Math.min(1048576, Math.max(128, Number(readJSON("omp-map-overview-memory", 2048)) || 2048));

function umapBlocked() {
  const active = document.activeElement;
  return Boolean(umapDrag) || Boolean(document.querySelector(".inline-menu"))
    || Boolean(active && $("umap-items")?.contains(active) && /^(input|textarea|select)$/i.test(active.tagName));
}
// 자주 오는 스냅샷 갱신은 0.4초에 한 번만 그린다. 입력·끌기 중이면 끝난 뒤 그린다.
function paintUmapSoon() {
  if (mapMode !== "map") return;
  clearTimeout(umapTimer);
  umapTimer = setTimeout(() => paintUmap(), Math.max(0, 400 - (Date.now() - umapPaintAt)));
}

function umapBandHead(band, box) {
  const stats = band.sessions.reduce((acc, session) => {
    const st = monitorSessionStats(session, umapMemoryLimit());
    acc.tokens += st.tokens; acc.cost += st.cost; acc.cpu += st.cpu || 0; acc.ram += st.ram || 0;
    if (st.main && (askPending(st.main.id) || st.resourceWarning || ATTN.has(st.main.id))) acc.attention++;
    return acc;
  }, { tokens: 0, cost: 0, cpu: 0, ram: 0, attention: 0 });
  const waiting = band.tasks.filter((task) => umapTaskGroup(task) === 0).length;
  const parts = [`세션 ${band.sessions.length}`, `토큰 ${fmt(stats.tokens)}`, krw(stats.cost),
    `<b class="${stats.attention + waiting ? "um-warn" : ""}">주의 ${stats.attention + waiting}</b>`, `CPU ${Math.round(stats.cpu)}%`, `RAM ${memSize(Math.round(stats.ram))}`];
  const project = band.project;
  const counts = new Map();
  for (const task of band.tasks) counts.set(task.status, (counts.get(task.status) || 0) + 1);
  const labels = project ? (band.labels.length ? band.labels : Object.entries(TASK_STATUS).map(([status, meta]) => ({ status, label: meta.label, builtin: true }))) : [];
  const legend = labels.map((item) => `<button class="um-st" data-um="status" data-status="${esc(item.status)}" style="--c:${umapStatusColor(item.status)}" title="눌러서 이름 바꾸기${item.builtin ? "" : " · 지우기"}"><i></i>${esc(item.label)} <b>${counts.get(item.status) || 0}</b></button>`).join("")
    + (project ? `<button class="um-st um-st-add" data-um="status-add" title="상태 칸 더하기">＋</button>` : "");
  const metrics = project ? umapMetricsHTML(project.id) : `<span class="um-muted">아직 프로젝트가 아닙니다 · ＋ Task 를 만들면 이 폴더가 프로젝트가 됩니다</span>`;
  return `<section class="um-band" data-band="${esc(band.key)}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">
    <header class="um-band-head" data-band-head="${esc(band.key)}">
      <div class="um-line"><b class="um-band-title" title="${esc(band.folder)}">${esc(band.title)}</b><span class="um-path" title="${esc(band.folder)}">${esc(cut(band.folder, 44))}${project?.branch ? " · " + esc(project.branch) : ""}</span>
        <span class="um-stats">${parts.join(" · ")}</span><span class="um-spacer"></span>
        <button class="um-add" data-um="add-task" title="이 프로젝트에 Task 한 줄 만들기 (Alt+T)">＋ Task</button><button data-um="band-menu" aria-label="${esc(band.title)} 띠 메뉴">⋯</button></div>
      <div class="um-line um-line2"><span class="um-metrics">${metrics}</span><span class="um-legend">${legend}</span></div>
    </header></section>`;
}
function umapMetricsHTML(project) {
  const entry = UM.metrics.get(project);
  if (!entry) return `<span class="um-muted">지표 불러오는 중</span>`;
  const count = entry.dashboard?.measures?.count ?? 0;
  const spent = entry.budget ? Math.ceil(entry.budget.committed) : (entry.dashboard?.usage ?? []).reduce((sum, item) => sum + (item.costCents ?? 0), 0);
  return `<button class="inline-num" data-um="period" title="집계 기간 · 눌러서 고치기">최근 ${entry.days}일</button> 실행 ${count}건 · ${umapDollars(spent)} / 예산 <button class="inline-num" data-um="budget" title="프로젝트 예산 · 눌러서 고치기(비우면 제한 없음)">${entry.budget ? umapDollars(entry.budget.cap) : "없음"}</button>`;
}

function umapTaskHTML(band, task, box) {
  const color = umapStatusColor(task.status), label = umapStatusLabel(band, task.status), busy = umapTaskBusy(task);
  const flow = task.workflow ? `<span class="um-flow${task.workflow.local ? " local" : ""}" title="${esc(task.workflow.name)}${task.workflow.local ? " · 이 Task 전용 사본" : ""}">${task.workflow.local ? "<i>✎</i>" : ""}${esc(cut(task.workflow.name.replace(/ · Task [0-9a-f-]{8}$/, ""), 18))}</span>` : `<span class="um-flow">Workflow 없음</span>`;
  const done = task.stages.filter(({ status }) => status === "succeeded").length;
  const base = `data-key="${esc(box.key)}" data-task="${esc(task.id)}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;--c:${color}"`;
  const cls = `um-card um-task st-${esc(task.status)}${box.manual ? " manual" : ""}${UM.edit?.task === task.id ? " um-edit-row" : ""}${umapDimTask(task) ? " um-dim" : ""}`;
  if (UM.edit?.task === task.id) {
    return `<article class="${cls} um-editing" ${base}>
      <div class="um-task-top"><i class="um-pill">Workflow 편집</i><span class="um-spacer"></span><button data-um="edit-done" class="go" title="편집 끝내기 (Esc)">완료</button></div>
      <h4 class="um-task-title one" title="${esc(task.title)}">${esc(task.title)}</h4>
      <div class="um-edit-bar"><span>저장 범위</span><span class="um-seg" role="group" aria-label="저장 범위"><button data-um="edit-scope" data-scope="task" aria-pressed="${UM.edit.scope === "task"}">이 Task만</button><button data-um="edit-scope" data-scope="template" aria-pressed="${UM.edit.scope === "template"}">템플릿</button></span></div>
      <small class="um-edit-status">${esc(UM.edit.status || "＋ 넣기 · 끌어서 순서 · ⋯ 지우기")}</small></article>`;
  }
  const meta = task.run ? `${esc(UMAP_STAGE_STATE[task.run.status] || label)} · ${done}/${task.stages.length}단계 · ${umapDollars(task.run.costCents)} · ${esc(ago(task.run.updated))}`
      : `아직 실행 전 · ${Math.round(task.timeoutMs / 60000)}분 · ${umapDollars(task.budgetCents)}`;
  return `<article class="${cls}" ${base}>
    <div class="um-task-top"><i class="um-pill">${esc(label)}</i>${flow}<span class="um-spacer"></span>
      <button class="um-run" data-um="run" ${busy ? "disabled" : ""} title="${busy ? "실행 중입니다" : "실행 · " + esc(task.workflow?.name || "")}" aria-label="${esc(task.title)} 실행">▶</button><button data-um="task-menu" aria-label="Task 메뉴">⋯</button></div>
    <h4 class="um-task-title" title="${esc(task.title)} · 눌러서 내용·한도 고치기">${esc(task.title)}</h4>
    <p class="um-task-meta">${meta}</p></article>`;
}

function umapStageHTML(task, stage, box) {
  const fresh = !task.run, editing = UM.edit?.task === task.id;
  const chips = [];
  if (stage.harness) chips.push(`<button class="um-chip h" data-um="harness" title="하네스 · ${esc(stage.harness.role || "")}"><i>H</i>${esc(cut(stage.harness.name.replace(/ · Task [0-9a-f-]{8}$/, ""), 18))}</button>`);
  if (stage.loop) chips.push(`<button class="um-chip l" data-um="loop" title="루프 · 검증 ${esc(stage.loop.checks.map((c) => [c.command, ...c.args].join(" ")).join(", "))}"><i>↻</i>${stage.loop.attempts}회 · ${Math.round(stage.loop.timeoutMs / 60000)}분</button>`);
  if (stage.harness?.model) chips.push(`<span class="um-model" title="${esc(stage.harness.model.name)}">${esc(cut(modelShort(stage.harness.model.model).replace(/^claude-/, ""), 16))}</span>`);
  if (stage.type === "command" && stage.check) chips.push(`<span class="um-model">${esc(cut([stage.check.command, ...stage.check.args].join(" "), 26))}</span>`);
  const live = stage.live ? `<p class="um-live" title="${esc(stage.live.text || "")}">${esc(stage.live.tool || stage.live.phase || "")} ${esc(cut((stage.live.text || "").split("\n").filter(Boolean).pop() || "", 40))}</p>` : "";
  const approve = stage.status === "waiting_approval" && task.run
    ? `<div class="um-approve"><button class="go" data-um="approve">승인</button><button class="stop" data-um="reject">반려</button></div>` : "";
  const error = stage.status === "failed" && stage.error ? `<p class="um-live err" title="${esc(stage.error)}">${esc(cut(stage.error, 46))}</p>` : "";
  return `<article class="um-card um-stage s-${esc(stage.status)}${fresh ? " fresh" : ""}${box.manual ? " manual" : ""}${editing ? " um-edit-row editing" : ""}${umapDimTask(task) ? " um-dim" : ""}" data-key="${esc(box.key)}" data-task="${esc(task.id)}" data-node="${esc(stage.id)}"
    style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px" ${editing ? 'title="끌어서 순서 바꾸기"' : ""}>
    <div class="um-stage-top"><i class="um-dot"></i><span class="um-kind">${esc(UMAP_KIND[stage.type] || stage.type)}</span><span class="um-stage-state">${esc(UMAP_STAGE_STATE[stage.status] || stage.status)}</span>
      <span class="um-spacer"></span><button data-um="stage-menu" aria-label="단계 메뉴">⋯</button></div>
    <h5 class="um-stage-title" data-um="stage" title="눌러서 단계 고치기">${esc(stage.label)}</h5>
    <div class="um-chips">${chips.join("")}</div>${approve || live || error}</article>`;
}

function umapLinksSVG(layout) {
  const paths = layout.links.map(({ from, to, kind }) => {
    const a = layout.boxes[from], b = layout.boxes[to];
    if (kind === "sub") {
      // 서브에이전트 가지: 부모 왼쪽 아래에서 내려와 자식 왼쪽으로 꺾는다(들여쓴 칸 안이라 다른 노드를 가로지르지 않는다).
      const x1 = a.x + 14, y1 = a.y + a.h, y2 = b.y + Math.min(22, b.h / 2);
      return `<path class="um-l-sub" d="M${x1} ${y1} L${x1} ${y2 - 6} Q${x1} ${y2},${x1 + 6} ${y2} L${b.x} ${y2}"/>`;
    }
    if (kind === "session") {
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + Math.min(b.w / 2, 26), y2 = b.y;
      return `<path class="um-l-sess" d="M${x1} ${y1} C${x1} ${y1 + 16},${x2} ${y2 - 16},${x2} ${y2}"/>`;
    }
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mid = (x1 + x2) / 2;
    return `<path class="um-l-${kind}" d="M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}"/>`;
  });
  return `<defs><marker id="um-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#5fb4ff"/></marker></defs>` + paths.join("");
}

function paintUmap(force = false) {
  if (mapMode !== "map" || !$("umap-items")) return;
  if (!force && umapBlocked()) { umapPending = true; return; }
  umapPending = false;
  umapPaintAt = Date.now();
  UMAP_BANDS = umapBands(filteredSessions());
  const layout = UMAP_LAYOUT = umapLayout(UMAP_BANDS, { manual: UM.manual, width: UMAP.MIN_W });
  const agents = (items, dim) => { for (const item of umapFlatItems(items)) { const b = layout.boxes[umapSessionKey(item.id)]; if (b) html.push(umapAgentHTML(item, b, dim)); } };
  const html = [];
  UMAP_BANDS.forEach((band, index) => {
    html.push(umapBandHead(band, layout.bands[index]));
    const add = layout.boxes["add:" + band.key];
    if (add) html.push(umapAddLineHTML(band, add));
    const empty = layout.boxes["empty:" + band.key];
    if (empty) html.push(`<p class="um-empty" style="left:${empty.x}px;top:${empty.y}px;width:${empty.w}px">＋ Task 로 첫 Task 를 만들거나 위쪽 ＋ 세션으로 세션을 여세요.</p>`);
    for (const task of band.tasks) {
      const box = layout.boxes[umapTaskKey(task.id)];
      if (!box) continue;
      html.push(umapTaskHTML(band, task, box));
      for (const stage of task.stages) {
        const sbox = layout.boxes[umapStageKey(task.id, stage.id)];
        html.push(umapStageHTML(task, stage, sbox));
        agents(stage.sessions, umapDimTask(task));
      }
      if (UM.edit?.task === task.id) html.push(umapEditPlusHTML(task, layout));
    }
    for (const group of band.free) {
      const label = layout.boxes["folder:" + band.key + ":" + group.folder];
      html.push(`<div class="um-folder" style="left:${label.x}px;top:${label.y}px;width:${label.w}px">Task 없이 연 세션 · <span title="${esc(group.folder)}">${esc(group.folder)}</span> · ${group.sessions.length}</div>`);
      agents(group.sessions, false);
    }
  });
  if (!UMAP_BANDS.length) html.push(`<p class="um-empty" style="left:20px;top:20px;width:640px">${UM.loaded ? "표시할 프로젝트·세션이 없습니다. 위쪽 필터를 넓히거나 ＋ 세션·＋ 새 실행으로 시작하세요." : esc(UM.error || "불러오는 중…")}</p>`);
  const items = $("umap-items");
  items.innerHTML = html.join("");
  const svg = $("umap-links");
  svg.setAttribute("width", layout.width + 40);
  svg.setAttribute("height", layout.height + 40);
  svg.innerHTML = umapLinksSVG(layout);
  $("umap").classList.toggle("editing", Boolean(UM.edit));
  umapApplyView();
  for (const input of items.querySelectorAll(".um-add-text")) if (UM.adding?.focus) { input.focus(); UM.adding.focus = false; }
  if (typeof paintUmapTopbar === "function") paintUmapTopbar(UMAP_BANDS);
}
function umapApplyView() {
  const surface = $("umap-surface");
  if (surface) surface.style.transform = `translate(${UM.view.x}px,${UM.view.y}px) scale(${UM.view.k})`;
  const zk = $("zk");
  if (zk && mapMode === "map") zk.textContent = Math.round(UM.view.k * 100) + "%";
}
// 끝난 Task 는 접지 않고 흐리게 그린다(편집 중이면 또렷하게).
const umapDimTask = (task) => task.status === "completed" && UM.edit?.task !== task.id;
