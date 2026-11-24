const columns = {
  backlog: "Backlog", ready: "준비", running: "진행 중", waiting_approval: "승인 대기",
  blocked: "보류", completed: "완료",
};

export function bindSdlc({ find, request, report, showRun }) {
  const form = find("sdlc-form"), selector = form.elements.workflow, board = find("sdlc-board");
  const stageForm = find("sdlc-stage-form");
  let project = "", editing, tasks = [], workflows = [], stages = [], refreshPending = false, lastMetrics = 0;
  const pending = new Map();

  function formOptions() {
    const mapped = stages.find(({ status, workflow }) => status === "backlog" && workflow) ?? stages.find(({ status }) => status === "ready");
    const fallback = mapped?.workflow ? mapped.workflow + ":" + mapped.workflow_version : "";
    const selected = editing ? editing.workflow + ":" + editing.workflow_version : selector.value || fallback;
    const options = workflows.map((entry) => new Option(entry.name + " · v" + entry.version, entry.id + ":" + entry.version));
    if (editing && !options.some(({ value }) => value === selected)) {
      options.unshift(new Option(editing.workflow_name + " · v" + editing.workflow_version, selected));
    } else if (fallback && !options.some(({ value }) => value === fallback)) {
      options.unshift(new Option("단계 기본 Workflow · v" + mapped.workflow_version, fallback));
    }
    selector.replaceChildren(new Option("Workflow 선택", ""), ...options);
    selector.value = selected;
  }

  function stageValues() {
    const stage = stages.find(({ status }) => status === stageForm.elements.status.value);
    if (!stage) return;
    stageForm.elements.label.value = stage.label;
    stageForm.elements.position.value = stage.position;
    const mapping = stage.workflow ? stage.workflow + ":" + stage.workflow_version : "";
    const options = workflows.map((flow) => new Option(flow.name + " · v" + flow.version, flow.id + ":" + flow.version));
    if (mapping && !options.some(({ value }) => value === mapping)) options.unshift(new Option("이전 기본 버전", mapping));
    stageForm.elements.workflow.replaceChildren(new Option("지정 안 함", ""), ...options);
    stageForm.elements.workflow.value = mapping;
  }

  function edit(task) {
    editing = task;
    form.reset();
    if (task) {
      form.elements.title.value = task.title;
      form.elements.instruction.value = task.instruction;
    }
    formOptions();
  }

  function control(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = report(handler);
    return button;
  }

  function card(task) {
    const item = document.createElement("article"), title = document.createElement("h4"), flow = document.createElement("p");
    title.textContent = task.title;
    flow.textContent = task.workflow_name + " · v" + task.workflow_version;
    item.append(title, flow);
    item.append(control("상세", async () => edit(task)));
    if (task.latest_run) item.append(control("실행 이력", async () => showRun(task.latest_run)));
    if (task.status === "ready") item.append(control("Workflow 실행", async () => {
      const timeoutMs = Number(find("sdlc-minutes").value) * 60000, budgetCents = Number(find("sdlc-budget").value);
      const input = { task: task.id, timeoutMs, budgetCents };
      const fingerprint = JSON.stringify(input), entry = pending.get(task.id);
      const key = entry?.fingerprint === fingerprint ? entry.key : crypto.randomUUID();
      pending.set(task.id, { fingerprint, key });
      const run = await request("workflow-runs", {}, { ...input, key });
      pending.delete(task.id);
      await refresh();
      await showRun(run.id);
    }));
    for (const next of ["ready", "backlog"]) {
      if (next === task.status || ["running", "waiting_approval"].includes(task.status)) continue;
      item.append(control(columns[next] + "로 이동", async () => {
        await request("tasks/move", {}, { id: task.id, status: next, revision: task.revision });
        await refresh();
      }));
    }
    return item;
  }

  function render() {
    const configured = stages.length ? stages.map(({ status, label }) => [status, label]) : Object.entries(columns);
    board.replaceChildren(...configured.map(([status, label]) => {
      const section = document.createElement("section"), heading = document.createElement("h3");
      heading.textContent = label;
      section.append(heading, ...tasks.filter((task) => task.status === status).map(card));
      return section;
    }));
  }

  async function refresh(loadWorkflows = false) {
    const owner = project;
    if (!owner) { tasks = []; workflows = []; formOptions(); render(); return; }
    const loadMetrics = loadWorkflows || Date.now() - lastMetrics >= 15000;
    const [rows, saved, approvals, metrics, settings, budget] = await Promise.all([request("tasks", { project: owner }),
      loadWorkflows ? request("workflows", { project: owner }) : Promise.resolve(null),
      request("workflow-approvals", { project: owner }),
      loadMetrics ? request("workflow-dashboard", { project: owner, days: find("sdlc-period").value }) : null,
      loadWorkflows ? request("sdlc-stages", { project: owner }) : null,
      loadWorkflows ? request("project-budget", { project: owner }) : null]);
    if (owner !== project) return;
    tasks = rows;
    if (settings) {
      stages = settings;
      const previous = stageForm.elements.status.value;
      stageForm.elements.status.replaceChildren(...stages.map(({ status, label }) => new Option(label, status)));
      if (stages.some(({ status }) => status === previous)) stageForm.elements.status.value = previous;
    }
    if (saved) { workflows = saved; formOptions(); stageValues(); }
    if (budget) showBudget(budget.current);
    render();
    find("sdlc-inbox").replaceChildren(...approvals.map((approval) => {
      const item = document.createElement("li");
      item.append(approval.title + " · " + approval.prompt, control("승인 검토", async () => showRun(approval.run)));
      return item;
    }));
    if (!metrics) return;
    lastMetrics = Date.now();
    const categories = { reported: "보고 비용", reserved: "예약 비용", unknown_basis: "출처 미확인", missing: "비용 미수집" };
    find("sdlc-metrics").replaceChildren(...[
      "완료 " + metrics.measures.completed + "/" + metrics.measures.count + "건 · 노드 재시도 " + metrics.measures.retries +
        "건 · 승인·거절 " + metrics.measures.decisions + "건",
      ...(metrics.measures.averageMs === null ? [] : ["완료 실행 평균 소요 " + (metrics.measures.averageMs / 1000).toFixed(1) + "초"]),
      ...metrics.states.map(({ status, count }) => status + " " + count + "건"),
      ...metrics.usage.map(({ category, model, agent, count, costCents }) =>
        [categories[category], model, agent, count + "건", costCents === null ? "" : "$" + (costCents / 100).toFixed(2)].filter(Boolean).join(" · ")),
    ].map((label) => { const line = document.createElement("p"); line.textContent = label; return line; }));
  }

  find("sdlc-new").onclick = () => edit(null);
  const budgetForm = find("project-budget-form");
  function showBudget(current) {
    budgetForm.elements.cap.value = current?.cap ?? "";
    budgetForm.elements.days.value = current?.days ?? 30;
    find("project-budget-status").textContent = current
      ? "사용 및 실행 중인 예약 " + Math.ceil(current.committed) + " / " + current.cap + "센트"
      : "프로젝트 예산 제한 없음";
  }
  budgetForm.addEventListener("submit", report(async () => {
    if (!project) throw new Error("프로젝트를 선택해 주세요.");
    const owner = project, { cap, days } = budgetForm.elements;
    const result = await request("project-budget", {}, { project: owner, cap: Number(cap.value), days: Number(days.value) });
    if (owner === project) showBudget(result.current);
  }));
  find("project-budget-remove").onclick = report(async () => {
    if (!project) return;
    const owner = project;
    const result = await request("project-budget", {}, { project: owner, remove: true });
    if (owner === project) showBudget(result.current);
  });
  find("sdlc-period").onchange = report(async () => { lastMetrics = 0; await refresh(); });
  stageForm.elements.status.onchange = stageValues;
  stageForm.addEventListener("submit", report(async () => {
    if (!project) throw new Error("프로젝트를 선택해 주세요.");
    const fields = Object.fromEntries(new FormData(stageForm)), [workflow, version] = fields.workflow.split(":");
    await request("sdlc-stages", {}, { project, status: fields.status, label: fields.label,
      position: Number(fields.position), workflow, version: Number(version) });
    await refresh(true);
  }));
  find("sdlc-nav").addEventListener("click", report(async () => refresh(true)));
  form.addEventListener("submit", report(async () => {
    if (!project) throw new Error("프로젝트를 선택해 주세요.");
    const [workflow, version] = selector.value.split(":");
    const owner = project;
    await request("tasks", {}, { project: owner, title: form.elements.title.value, instruction: form.elements.instruction.value,
      workflow, version: Number(version), id: editing?.id, revision: editing?.revision });
    if (owner !== project) return;
    edit(null);
    await refresh();
  }));

  setInterval(async () => {
    if (refreshPending || find("sdlc").hidden || !project) return;
    refreshPending = true;
    try { await refresh(); } catch { /* the next poll retries */ } finally { refreshPending = false; }
  }, 2000);

  return { async selectProject(id) {
    if (id === project) return;
    project = id; tasks = []; workflows = []; stages = []; lastMetrics = 0; edit(null);
    await refresh(true);
  } };
}
