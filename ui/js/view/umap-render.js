/* omp-live-map · view · 관제 벽 그리기: 프로젝트마다 타일 하나(머리: 이름 · 한 줄 지표 · 상태 한 줄 · ＋ Task)를 격자에 채우고,
   타일 본문에 승인된 내용 그대로 Task 카드 · Workflow 단계(하네스·루프 칩) · 단계 아래 에이전트 나무(view/umap-agent.js) · Task 없이 연 세션을 그린다.
   타일 격자·순서·크기는 model/umap-wall.js, 타일 안 배치는 model/task-map.js umapTileLayout, 데이터·타일 상태는 viewmodel/task-map.js.
   접기·펼치기·의미 확대 없음: 쉬는 타일은 내용대로 작게(머리 + '최근 끝남' 한 줄) 그릴 뿐 단추로 접지 않는다. 입력·끌기는 view/umap-input.js. */

let UMAP_LAYOUT = null, UMAP_BANDS = [], UMAP_TILES = new Map(), UMAP_PACK = null, UMAP_GRID = null, UMAP_WALL_PX = { width: 0, height: 0 };
let umapPending = false, umapPaintAt = 0, umapTimer = 0;
// 타일 테두리(2px) + 본문 세로 스크롤 막대 자리. 타일 안 배치 폭 = 타일 폭 − 이 값.
const UMAP_TILE_CHROME = 16;
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

// 타일 머리: 1줄 이름 · 상태 · ＋ Task · ⋯, 2줄 한 줄 지표(세션 · 토큰 · 비용 · 주의 · CPU · RAM), 3줄 지금 상태 한 줄. 전체 화면이면 4줄 기간 지표·상태 칸.
function umapTileHead(band, meta, focus) {
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
  let extra = "";
  if (focus) {
    const counts = new Map();
    for (const task of band.tasks) counts.set(task.status, (counts.get(task.status) || 0) + 1);
    const labels = project ? (band.labels.length ? band.labels : Object.entries(TASK_STATUS).map(([status, m]) => ({ status, label: m.label, builtin: true }))) : [];
    const legend = labels.map((item) => `<button class="um-st" data-um="status" data-status="${esc(item.status)}" style="--c:${umapStatusColor(item.status)}" title="눌러서 이름 바꾸기${item.builtin ? "" : " · 지우기"}"><i></i>${esc(item.label)} <b>${counts.get(item.status) || 0}</b></button>`).join("")
      + (project ? `<button class="um-st um-st-add" data-um="status-add" title="상태 칸 더하기">＋</button>` : "");
    const metrics = project ? umapMetricsHTML(project.id) : `<span class="um-muted">아직 프로젝트가 아닙니다 · ＋ Task 를 만들면 이 폴더가 프로젝트가 됩니다</span>`;
    extra = `<div class="um-line um-line2"><span class="um-path" title="${esc(band.folder)}">${esc(cut(band.folder, 60))}${project?.branch ? " · " + esc(project.branch) : ""}</span><span class="um-metrics">${metrics}</span><span class="um-legend">${legend}</span></div>`;
  }
  const back = focus ? `<button class="um-wall-back" data-um="wall" title="관제 벽으로 돌아가기 (Esc · 머리 두 번 누르기)">벽으로</button>` : "";
  return `<header class="um-tile-head" data-band-head="${esc(band.key)}" title="${focus ? "두 번 눌러 관제 벽으로" : "끌어서 순서 바꾸기 · 두 번 눌러 전체 화면"}">
      <div class="um-line"><b class="um-band-title" title="${esc(band.folder)}">${esc(band.title)}</b><i class="um-tile-state">${esc(UMAP_TILE_LABEL[meta.state])}</i><span class="um-spacer"></span>
        ${back}<button class="um-add" data-um="add-task" title="이 프로젝트에 Task 한 줄 만들기 (Alt+T)">＋ Task</button><button data-um="band-menu" aria-label="${esc(band.title)} 타일 메뉴">⋯</button></div>
      <div class="um-line"><span class="um-stats">${parts.join(" · ")}</span></div>
      ${umapTileSummaryHTML(band, meta)}${extra}</header>`;
}
// 상태 한 줄: 개입 필요면 무엇을(승인·보류·답), 진행 중이면 무엇이 도는지, 쉬면 '최근 끝남'.
function umapTileSummaryHTML(band, meta) {
  const line = (cls, text, title = text) => `<div class="um-tile-sum ${cls}" title="${esc(title)}">${text}</div>`;
  if (meta.state === "attention") {
    const [first, ...more] = meta.attention;
    return line("attention", `⚠ ${esc(first.label)}${more.length ? ` <small>외 ${more.length}건</small>` : ""}`, meta.attention.map(({ label }) => label).join("\n"));
  }
  const items = umapFlatItems([...band.tasks.flatMap((task) => task.stages.flatMap((stage) => stage.sessions)), ...band.free.flatMap((group) => group.sessions)]);
  if (meta.state === "running") {
    const task = band.tasks.find((item) => item.status === "running");
    const stage = task?.stages.find(({ status }) => status === "running");
    const agent = items.find((item) => item.lines?.state === "running" && !item.lines.sub) || items.find((item) => item.lines?.state === "running");
    const what = task ? task.title + (stage ? " · " + stage.label : "") : agent ? agent.lines.title : "";
    const now = agent ? agent.lines.now : "";
    return line("running", `▶ 진행 중 · ${esc(what)}${now ? ` <span class="um-muted">· ${esc(now)}</span>` : ""}`, [what, now].filter(Boolean).join(" · "));
  }
  // 쉬는 중: 가장 최근에 끝난 Task(실행) 또는 세션.
  // Task 실행이 있으면 그것을(그 단계 세션이 몇 분 늦게 끝나도 같은 일이다), 훨씬 뒤에 끝난 대화형 세션이 있으면 그 세션을.
  const done = band.tasks.filter((task) => task.run).map((task) => ({ title: task.title, at: task.run.updated || task.updated || 0, state: UMAP_STAGE_STATE[task.run.status] || task.run.status }))
    .sort((a, b) => b.at - a.at)[0];
  const session = band.sessions.map((item) => ({ title: item.title || "세션", at: item.lastTs || 0, state: "대화형 세션" })).sort((a, b) => b.at - a.at)[0];
  const last = done && !(session && session.at > done.at + 600000) ? done : session;
  return last ? line("idle", `최근 끝남 · ${esc(last.title)} <span class="um-muted">· ${esc(last.state)} · ${esc(ago(last.at))}</span>`, last.title)
    : line("idle", `<span class="um-muted">최근 기록 없음 · ＋ Task 로 시작하세요</span>`, "");
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

// 선: 단계 → 다음 단계(같은 줄이면 옆으로, 줄을 넘기면 칸 사이 틈으로 돌아 내려간다 — 카드를 가로지르지 않는다), 단계 → 에이전트, 에이전트 → 서브에이전트.
function umapLinkPath(a, b, kind) {
  if (kind === "sub") {
    // 서브에이전트 가지: 부모 왼쪽 아래에서 내려와 자식 왼쪽으로 꺾는다(들여쓴 칸 안이라 다른 노드를 가로지르지 않는다).
    const x1 = a.x + 14, y1 = a.y + a.h, y2 = b.y + Math.min(22, b.h / 2);
    return `<path class="um-l-sub" d="M${x1} ${y1} L${x1} ${y2 - 6} Q${x1} ${y2},${x1 + 6} ${y2} L${b.x} ${y2}"/>`;
  }
  if (kind === "session") {
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + Math.min(b.w / 2, 26), y2 = b.y;
    return `<path class="um-l-sess" d="M${x1} ${y1} C${x1} ${y1 + 16},${x2} ${y2 - 16},${x2} ${y2}"/>`;
  }
  const y1 = a.y + Math.min(a.h, UMAP.STAGE_H) / 2, y2 = b.y + b.h / 2;
  if (b.x >= a.x + a.w - 1) {
    const x1 = a.x + a.w, x2 = b.x, mid = (x1 + x2) / 2;
    return `<path class="um-l-${kind}" d="M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}"/>`;
  }
  // 다음 줄(또는 아래)로 넘어간 단계: a 왼쪽 틈으로 나와 줄 사이로 건너 b 왼쪽으로 들어간다.
  const g = Math.max(4, Math.min(12, b.x - 4)), gap = Math.min(12, (b.y - a.y) / 2);
  return `<path class="um-l-${kind}" d="M${a.x} ${y1} H${a.x - g} V${b.y - gap} H${b.x - g} V${y2} H${b.x}"/>`;
}
function umapLinksSVG(layout) {
  const paths = layout.links.map(({ from, to, kind }) => umapLinkPath(layout.boxes[from], layout.boxes[to], kind));
  return `<defs><marker id="um-arrow-${esc(umapDomId(layout.key))}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#5fb4ff"/></marker></defs>`
    + paths.join("").replace(/class="um-l-(flow|start)"/g, `$& marker-end="url(#um-arrow-${esc(umapDomId(layout.key))})"`);
}
const umapDomId = (key) => String(key).replace(/[^A-Za-z0-9_-]/g, "_");

// 타일 본문(캔버스) 안의 카드들. 배치는 umapTileLayout 결과(layout).
function umapTileBodyHTML(band, layout) {
  const html = [];
  const agents = (items, dim) => { for (const item of umapFlatItems(items)) { const b = layout.boxes[umapSessionKey(item.id)]; if (b) html.push(umapAgentHTML(item, b, dim)); } };
  const add = layout.boxes["add:" + band.key];
  if (add) html.push(umapAddLineHTML(band, add));
  const empty = layout.boxes["empty:" + band.key];
  if (empty) html.push(`<p class="um-empty" style="left:${empty.x}px;top:${empty.y}px;width:${empty.w}px">＋ Task 로 첫 Task 를 만들거나 위쪽 ＋ 세션으로 세션을 여세요.</p>`);
  for (const task of band.tasks) {
    const box = layout.boxes[umapTaskKey(task.id)];
    if (!box) continue;
    html.push(umapTaskHTML(band, task, box));
    for (const stage of task.stages) {
      html.push(umapStageHTML(task, stage, layout.boxes[umapStageKey(task.id, stage.id)]));
      agents(stage.sessions, umapDimTask(task));
    }
    if (UM.edit?.task === task.id) html.push(umapEditPlusHTML(task, layout));
  }
  for (const group of band.free) {
    const label = layout.boxes["folder:" + band.key + ":" + group.folder];
    html.push(`<div class="um-folder" style="left:${label.x}px;top:${label.y}px;width:${label.w}px">Task 없이 연 세션 · <span title="${esc(group.folder)}">${esc(group.folder)}</span> · ${group.sessions.length}</div>`);
    agents(group.sessions, false);
  }
  return `<div class="um-tile-canvas" style="width:${layout.width}px;height:${layout.height}px"><svg class="um-links" aria-hidden="true" width="${layout.width}" height="${layout.height}">${umapLinksSVG(layout)}</svg>${html.join("")}</div>`;
}

// 타일 하나. 쉬는 타일(내용대로 작은 크기)은 머리만 — 접은 것이 아니라 보여 줄 일이 없다는 뜻이다. 크기를 키우면 본문이 보인다.
function umapTileHTML(entry, focus) {
  const { band, tile, rect, layout, meta } = entry;
  const body = focus || tile.h > UMAP_WALL.IDLE_H || tile.state !== "idle";
  const scroll = (focus ? "full|" : "wall|") + band.key;
  return `<section class="um-tile t-${esc(tile.state)}${focus ? " focus" : ""}${body ? "" : " small"}" data-band="${esc(band.key)}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px">
    ${umapTileHead(band, meta, focus)}${body ? `<div class="um-tile-body" data-body="${esc(band.key)}" data-scroll="${esc(scroll)}">${umapTileBodyHTML(band, layout)}</div>` : ""}
    ${focus ? "" : `<i class="um-tile-resize" data-tile-resize="${esc(band.key)}" title="끌어서 타일 크기 바꾸기(격자에 맞춤)"></i>`}</section>`;
}

// 다시 그려도 타일 본문의 스크롤 자리는 그대로(벽·전체 화면은 따로 기억한다).
function umapKeepScroll(root) {
  for (const body of root.querySelectorAll(".um-tile-body[data-scroll]")) UM.scroll.set(body.dataset.scroll, { top: body.scrollTop, left: body.scrollLeft });
}
function umapRestoreScroll(root) {
  for (const body of root.querySelectorAll(".um-tile-body[data-scroll]")) {
    const spot = UM.scroll.get(body.dataset.scroll);
    if (spot) { body.scrollTop = spot.top; body.scrollLeft = spot.left; }
  }
}

// 타일이 처음 보이거나 그 타일의 '지금 볼 곳'(개입 필요 항목 → 도는 단계 → 도는 에이전트)이 바뀌면 그곳으로 스크롤한다.
// 승인 단계처럼 아래에 에이전트가 없는 단계는 본문 아래쪽에 맞춰 바로 앞 단계의 에이전트 카드(한 일)가 함께 보이게 한다. 사용자가 굴린 자리는 그 뒤로 그대로 둔다.
function umapTileFocusKey(entry) {
  const { band, meta, layout } = entry;
  const first = meta.attention.find(({ key }) => layout.boxes[key]);
  if (first) return first.key;
  for (const task of band.tasks) {
    const stage = task.stages.find(({ status }) => status === "running");
    if (stage) return umapStageKey(task.id, stage.id);
  }
  const items = umapFlatItems(band.free.flatMap((group) => group.sessions));
  const agent = items.find((item) => item.lines?.state === "running");
  return agent ? umapSessionKey(agent.id) : "";
}
function umapAutoScroll(root) {
  for (const body of root.querySelectorAll(".um-tile-body[data-scroll]")) {
    const entry = UMAP_TILES.get(body.dataset.body), key = entry ? umapTileFocusKey(entry) : "", mark = body.dataset.scroll;
    if (!key || UM.autoFocus.get(mark) === key) continue;
    UM.autoFocus.set(mark, key);
    const box = entry.layout.boxes[key];
    const below = entry.layout.links.some(({ from, kind }) => from === key && kind === "session");
    body.scrollTop = box.kind === "stage" && !below ? Math.max(0, box.y + box.h + 12 - body.clientHeight) : Math.max(0, box.y - 8);
    UM.scroll.set(mark, { top: body.scrollTop, left: body.scrollLeft });
  }
}

function paintUmap(force = false) {
  if (mapMode !== "map" || !$("umap-items")) return;
  if (!force && umapBlocked()) { umapPending = true; return; }
  umapPending = false;
  umapPaintAt = Date.now();
  const items = $("umap-items");
  umapKeepScroll(items);
  UMAP_BANDS = umapBands(filteredSessions());
  if (UM.focus && !UMAP_BANDS.some(({ key }) => key === UM.focus)) { UM.focus = ""; UM.view = UM.focusReturn || { x: 0, y: 0, k: 1 }; UM.focusReturn = null; }
  const states = umapTileStates(UMAP_BANDS);
  const rect = $("umap-viewport").getBoundingClientRect();
  const view = { width: rect.width || innerWidth, height: rect.height || innerHeight - 90 };
  const grid = UMAP_GRID = umapWallGrid(view);
  // ＋ Task 한 줄을 연 쉬는 타일은 그 줄이 보이게 일하는 타일 크기로 그린다(순서는 그대로).
  const tiles = UMAP_BANDS.map((band) => ({ key: band.key, ...states.get(band.key), busy: UM.adding?.band === band.key }));
  const pack = UMAP_PACK = umapWallPack(tiles, { cols: grid.cols, order: UM.wall.order, sizes: UM.wall.sizes, fitRows: grid.rows });
  UMAP_WALL_PX = UM.focus ? { width: view.width, height: view.height } : umapWallSize(pack, grid);
  UMAP_TILES = new Map();
  const boxes = {}, html = [];
  for (const tile of pack.tiles) {
    const focus = UM.focus === tile.key;
    if (UM.focus && !focus) continue;
    const band = UMAP_BANDS.find(({ key }) => key === tile.key);
    const r = focus ? { x: 0, y: 0, w: view.width, h: view.height } : umapWallRect(tile, grid);
    const layout = umapTileLayout(band, { manual: UM.manual, width: Math.max(UMAP_AGENT.MIN_W + 20, Math.floor(r.w - UMAP_TILE_CHROME)) });
    const entry = { band, tile, rect: r, layout, meta: states.get(tile.key) };
    UMAP_TILES.set(tile.key, entry);
    Object.assign(boxes, layout.boxes);
    html.push(umapTileHTML(entry, focus));
  }
  UMAP_LAYOUT = { boxes, width: UMAP_WALL_PX.width, height: UMAP_WALL_PX.height };
  if (!UMAP_BANDS.length) html.push(`<p class="um-empty" style="left:20px;top:20px;width:640px">${UM.loaded ? "표시할 프로젝트·세션이 없습니다. 위쪽 필터를 넓히거나 ＋ 세션·＋ 새 실행으로 시작하세요." : esc(UM.error || "불러오는 중…")}</p>`);
  items.innerHTML = html.join("");
  items.style.width = UMAP_WALL_PX.width + "px";
  items.style.height = UMAP_WALL_PX.height + "px";
  umapRestoreScroll(items);
  umapAutoScroll(items);
  $("umap").classList.toggle("editing", Boolean(UM.edit));
  $("umap").classList.toggle("focus", Boolean(UM.focus));
  umapClampView();
  umapApplyView();
  for (const input of items.querySelectorAll(".um-add-text")) if (UM.adding?.focus) { input.focus({ preventScroll: true }); UM.adding.focus = false; }
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
