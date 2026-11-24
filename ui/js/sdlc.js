const columns = {
  backlog: "Backlog", ready: "준비", running: "진행 중", waiting_approval: "승인 대기",
  blocked: "보류", completed: "완료",
};

export function bindSdlc({ find, request, report, showRun }) {
  const form = find("sdlc-form"), selector = form.elements.workflow, board = find("sdlc-board");
  let project = "", editing, tasks = [], workflows = [], refreshPending = false;
  const pending = new Map();

  function formOptions() {
    const selected = editing ? editing.workflow + ":" + editing.workflow_version : selector.value;
    const options = workflows.map((entry) => new Option(entry.name + " · v" + entry.version, entry.id + ":" + entry.version));
    if (editing && !options.some(({ value }) => value === selected)) {
      options.unshift(new Option(editing.workflow_name + " · v" + editing.workflow_version, selected));
    }
    selector.replaceChildren(new Option("Workflow 선택", ""), ...options);
    selector.value = selected;
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
    board.replaceChildren(...Object.entries(columns).map(([status, label]) => {
      const section = document.createElement("section"), heading = document.createElement("h3");
      heading.textContent = label;
      section.append(heading, ...tasks.filter((task) => task.status === status).map(card));
      return section;
    }));
  }

  async function refresh(loadWorkflows = false) {
    const owner = project;
    if (!owner) { tasks = []; workflows = []; formOptions(); render(); return; }
    const [rows, saved] = await Promise.all([request("tasks", { project: owner }),
      loadWorkflows ? request("workflows", { project: owner }) : Promise.resolve(null)]);
    if (owner !== project) return;
    tasks = rows;
    if (saved) { workflows = saved; formOptions(); }
    render();
  }

  find("sdlc-new").onclick = () => edit(null);
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
    project = id; tasks = []; workflows = []; edit(null);
    await refresh(true);
  } };
}
