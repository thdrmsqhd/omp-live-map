/* omp-live-map · view · 한 맵 그리기: 프로젝트 띠(머리 한 줄 지표) · Task 카드 · Workflow 단계(하네스·루프 칩) · 단계 아래 실제 세션 카드.
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
  return `<section class="um-band${band.collapsed ? " collapsed" : ""}" data-band="${esc(band.key)}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">
    <header class="um-band-head" data-band-head="${esc(band.key)}">
      <div class="um-line"><button class="um-fold" data-um="fold" aria-expanded="${!band.collapsed}" title="띠 접기·펼치기">${band.collapsed ? "▸" : "▾"}</button>
        <b class="um-band-title" title="${esc(band.folder)}">${esc(band.title)}</b><span class="um-path" title="${esc(band.folder)}">${esc(cut(band.folder, 44))}${project?.branch ? " · " + esc(project.branch) : ""}</span>
        <span class="um-stats">${parts.join(" · ")}</span><span class="um-spacer"></span>
        <button class="um-add" data-um="add-task" title="이 프로젝트에 Task 한 줄 만들기 (Alt+T)">＋ Task</button><button data-um="band-menu" aria-label="${esc(band.title)} 띠 메뉴">⋯</button></div>
      ${band.collapsed ? "" : `<div class="um-line um-line2"><span class="um-metrics">${metrics}</span><span class="um-legend">${legend}</span></div>`}
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
  const cls = `um-card um-task st-${esc(task.status)}${box.manual ? " manual" : ""}${UM.edit?.task === task.id ? " um-edit-row" : ""}`;
  if (task.collapsed) {
    return `<article class="${cls} um-done" ${base} title="눌러서 펼치기"><i class="um-pill">${esc(label)}</i><b class="um-done-title">${esc(task.title)}</b>
      <span class="um-done-sum">${esc(task.workflow?.name.replace(/ · Task [0-9a-f-]{8}$/, "") || "")} · ${done}/${task.stages.length}단계${task.run ? " · " + umapDollars(task.run.costCents) + " · " + ago(task.run.updated) : ""}</span>
      <button data-um="expand" title="이 Task 줄 펼치기">펼치기</button><button data-um="task-menu" aria-label="Task 메뉴">⋯</button></article>`;
  }
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
  return `<article class="um-card um-stage s-${esc(stage.status)}${fresh ? " fresh" : ""}${box.manual ? " manual" : ""}${editing ? " um-edit-row editing" : ""}" data-key="${esc(box.key)}" data-task="${esc(task.id)}" data-node="${esc(stage.id)}"
    style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px" ${editing ? 'title="끌어서 순서 바꾸기"' : ""}>
    <div class="um-stage-top"><i class="um-dot"></i><span class="um-kind">${esc(UMAP_KIND[stage.type] || stage.type)}</span><span class="um-stage-state">${esc(UMAP_STAGE_STATE[stage.status] || stage.status)}</span>
      <span class="um-spacer"></span><button data-um="stage-menu" aria-label="단계 메뉴">⋯</button></div>
    <h5 class="um-stage-title" data-um="stage" title="눌러서 단계 고치기">${esc(stage.label)}</h5>
    <div class="um-chips">${chips.join("")}</div>${approve || live || error}</article>`;
}

function umapSessionHTML(item, box) {
  const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
  const manual = box.manual ? " manual" : "";
  if (!item.node) {
    return `<article class="um-card um-sess chip missing${manual}" data-key="${esc(box.key)}" style="${style}" title="세션 ${esc(item.entry.sessionId)} · 이 PC 기록(최근 기간)에 없습니다"><i class="dot done"></i><span>세션 ${esc(item.entry.sessionId.slice(0, 8))} · 기록 없음</span></article>`;
  }
  const n = item.node, name = ALIAS.get(n.id) || n.sessionTitle || n.title || n.name, ask = askPending(n.id);
  const state = ask ? "선택 필요" : { live: "실행 중", idle: "유휴", done: "완료" }[n.status] || n.status;
  const attempt = item.entry ? `시도 ${item.entry.attempt}${item.entry.retry ? " · 재시도 " + item.entry.retry : ""} · ` : "";
  if (item.compact) {
    return `<article class="um-card um-sess chip ${esc(n.status)}${ask ? " ask" : ""}${manual}" data-key="${esc(box.key)}" data-node="${esc(n.id)}" style="${style}" title="${esc(name)} · 눌러서 펼치기 · 두 번 눌러 열기">
      <i class="dot ${esc(n.status)}"></i><span class="um-sess-name">${esc(name)}</span><small>${esc(attempt.replace(/ · $/, "") || state)} · ${krw(n.cost)}</small></article>`;
  }
  const now = (n.active || [])[0];
  const line = now ? now.name + " · " + cut(now.args || "", 60) : n.lastAssistant ? cut(n.lastAssistant, 70) : n.lastUser ? cut(n.lastUser, 70) : "최근 작업 기록 없음";
  return `<article class="um-card um-sess ${esc(n.status)}${ask ? " ask" : ""}${manual}" data-key="${esc(box.key)}" data-node="${esc(n.id)}" style="${style}" title="두 번 눌러 열기">
    <div class="um-sess-top"><i class="dot ${esc(n.status)}"></i><span class="um-sess-name">${esc(name)}</span>${ask ? '<b class="um-ask">선택 필요</b>' : ""}<button data-um="open" title="세션 열기 (더블클릭)">열기</button></div>
    <div class="um-sess-meta">${harnessChip(n)} <span>${esc(cut(modelShort(n.model || "모델 미상").replace(/^claude-/, ""), 16))}</span> · 토큰 ${fmt(n.tokens?.total || 0)} · ${krw(n.cost)}</div>
    <div class="um-sess-now">${esc(attempt)}${esc(state)} · ${esc(line)}</div></article>`;
}

function umapLinksSVG(layout) {
  const paths = layout.links.map(({ from, to, kind }) => {
    const a = layout.boxes[from], b = layout.boxes[to];
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
  const html = [];
  UMAP_BANDS.forEach((band, index) => {
    html.push(umapBandHead(band, layout.bands[index]));
    if (band.collapsed) return;
    const add = layout.boxes["add:" + band.key];
    if (add) html.push(umapAddLineHTML(band, add));
    const empty = layout.boxes["empty:" + band.key];
    if (empty) html.push(`<p class="um-empty" style="left:${empty.x}px;top:${empty.y}px;width:${empty.w}px">＋ Task 로 첫 Task 를 만들거나 위쪽 ＋ 세션으로 세션을 여세요.</p>`);
    for (const task of band.tasks) {
      const box = layout.boxes[umapTaskKey(task.id)];
      if (!box) continue;
      html.push(umapTaskHTML(band, task, box));
      if (task.collapsed) continue;
      for (const stage of task.stages) {
        const sbox = layout.boxes[umapStageKey(task.id, stage.id)];
        html.push(umapStageHTML(task, stage, sbox));
        for (const item of stage.sessions) { const b = layout.boxes[umapSessionKey(item.id)]; if (b) html.push(umapSessionHTML(item, b)); }
      }
      if (UM.edit?.task === task.id) html.push(umapEditPlusHTML(task, layout));
    }
    for (const group of band.free) {
      const label = layout.boxes["folder:" + band.key + ":" + group.folder];
      html.push(`<div class="um-folder" style="left:${label.x}px;top:${label.y}px;width:${label.w}px">Task 없이 연 세션 · <span title="${esc(group.folder)}">${esc(group.folder)}</span> · ${group.sessions.length}</div>`);
      for (const item of group.sessions) html.push(umapSessionHTML(item, layout.boxes[umapSessionKey(item.id)]));
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
