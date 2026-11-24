export function bindWorkflowRuns({ el, request, report, current, projectId }) {
  const list = el("run-list"), approval = el("approval");
  let pending, selected, refreshing = false;

  async function refresh(preferred = list.value) {
    const project = projectId();
    const rows = project ? await request("workflow-runs", { project }) : [];
    if (project !== projectId()) return;
    list.replaceChildren(new Option("실행 선택", ""), ...rows.map((row) => new Option(row.title + " · " + row.status, row.id)));
    const id = rows.some((row) => row.id === preferred) ? preferred : "";
    list.value = id;
    const detail = id ? await request("workflow-run", { id }) : null;
    if (project !== projectId() || id !== list.value) return;
    selected = detail;
    const waiting = detail?.nodes.find((node) => node.status === "waiting_approval");
    approval.hidden = !waiting || detail.run.status !== "waiting_approval";
    const actions = el("run-actions");
    actions.hidden = !detail;
    const status = detail?.run.status;
    actions.querySelector('[data-action="pause"]').disabled = status !== "running";
    actions.querySelector('[data-action="resume"]').disabled = !["paused", "interrupted"].includes(status) ||
      detail?.nodes.some((node) => node.status === "interrupted");
    actions.querySelector('[data-action="cancel"]').disabled =
      !["queued", "running", "paused", "waiting_approval", "interrupted"].includes(status);
    el("run-status").textContent = detail ? [status, detail.run.error, detail.run.workspace].filter(Boolean).join(" · ") : "";
    el("run-nodes").replaceChildren(...(detail?.nodes ?? []).map((node) => {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = (detail.labels[node.node] ?? node.node) + " · " + node.status;
      item.append(heading);
      if (node.outcome) {
        const details = document.createElement("pre");
        details.textContent = JSON.stringify(node.outcome, null, 2);
        item.append(details);
      }
      return item;
    }));
  }

  el("run-form").addEventListener("submit", report(async (event) => {
    const workflow = current();
    if (!workflow) throw new Error("먼저 Workflow 버전을 저장하거나 선택해 주세요.");
    const form = new FormData(event.currentTarget);
    const input = { project: projectId(), workflow: workflow.id, version: workflow.version, title: form.get("title"),
      timeoutMs: Number(form.get("minutes")) * 60000, budgetCents: Number(form.get("budget")) };
    const identity = JSON.stringify(input);
    if (pending?.identity !== identity) pending = { identity, key: crypto.randomUUID() };
    const run = await request("workflow-runs", {}, { ...input, key: pending.key });
    pending = null;
    await refresh(run.id);
  }));
  list.addEventListener("change", report(async () => refresh()));
  el("run-actions").addEventListener("click", report(async (event) => {
    if (!selected || !event.target.dataset.action) return;
    await request("workflow-runs/action", {}, { id: selected.run.id, operation: event.target.dataset.action });
    await refresh();
  }));
  approval.addEventListener("submit", report(async (event) => {
    const node = selected?.nodes.find((item) => item.status === "waiting_approval");
    if (!node || !event.submitter) return;
    await request("workflow-runs/approval", {}, { id: selected.run.id, node: node.node,
      decision: event.submitter.value, reason: approval.elements.reason.value });
    approval.reset();
    await refresh();
  }));
  setInterval(async () => {
    if (refreshing || document.getElementById("workflow").hidden || !projectId()) return;
    refreshing = true;
    try { await refresh(); } catch { /* the next poll retries */ } finally { refreshing = false; }
  }, 1800);
  return { refresh };
}
