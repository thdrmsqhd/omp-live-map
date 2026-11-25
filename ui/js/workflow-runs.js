import { harnessProvenance } from "./harness-provenance.js";

export function bindWorkflowRuns({ el, request, report, current, projectId, onStatus, focusedNode }) {
  const list = el("run-list"), approval = el("approval");
  const deliveryForm = el("delivery-form"), deliveryActions = el("delivery-actions");
  const stageForm = el("staging-form");
  const dialog = el("run-dialog"), runForm = el("run-form"), launchStatus = el("launch-status");
  const submitRun = runForm.querySelector('button:not([type])');
  let pending, selected, refreshing = false, submitting = false, refreshVersion = 0;
  let nodeResultsVersion = "", explicitRefreshes = 0;

  el("open-run").onclick = () => {
    const workflow = current();
    if (!workflow) return;
    el("run-version").textContent = workflow.name + " · v" + workflow.version;
    launchStatus.textContent = "";
    dialog.showModal();
  };
  el("close-run").onclick = () => dialog.close();

  function focus() {
    const id = focusedNode();
    const results = el("run-nodes");
    results.querySelector("[data-no-result]")?.remove();
    for (const item of results.children) item.hidden = Boolean(id) && item.dataset.node !== id;
    if (id && ![...results.children].some((item) => item.dataset.node === id)) {
      const empty = document.createElement("li");
      empty.dataset.noResult = "";
      const node = selected?.graph?.nodes.find((item) => item.id === id);
      empty.textContent = node?.type === "profile"
        ? `${node.label} · 연결된 Agent에 적용된 프로필 v${node.profileVersion}`
        : "이 노드의 실행 결과가 아직 없습니다.";
      results.append(empty);
    }
  }

  async function refresh(preferred = list.value) {
    explicitRefreshes++;
    try { await load(preferred); } finally { explicitRefreshes--; }
  }

  async function load(preferred) {
    const project = projectId(), version = ++refreshVersion;
    const rows = project ? await request("workflow-runs", { project }) : [];
    if (project !== projectId() || version !== refreshVersion) return;
    list.replaceChildren(new Option("편집 화면", ""), ...rows.map((row) => new Option(row.title + " · " + row.status, row.id)));
    const id = rows.some((row) => row.id === preferred) ? preferred : "";
    list.value = id;
    const detail = id ? await request("workflow-run", { id }) : null;
    if (project !== projectId() || version !== refreshVersion || id !== list.value) return;
    if (selected?.run.id !== detail?.run.id) {
      el("review-output").hidden = true;
      deliveryForm.elements.branch.value = detail?.delivery?.head ?? "";
    }
    selected = detail;
    onStatus(detail);
    const waiting = detail?.nodes.find((node) => node.status === "waiting_approval");
    approval.hidden = !waiting || detail.run.status !== "waiting_approval";
    const actions = el("run-actions");
    actions.hidden = !detail;
    const status = detail?.run.status;
    const delivery = detail?.delivery;
    const deployment = detail?.staging;
    el("delivery").hidden = status !== "succeeded" || !detail.run.workspace;
    deliveryForm.hidden = Boolean(delivery && delivery.state !== "approved");
    deliveryActions.querySelector('[data-delivery="pr"]').disabled = !delivery || delivery.state === "created";
    deliveryActions.querySelector('[data-delivery="ci"]').disabled = !delivery?.pr_number;
    deliveryActions.querySelector('[data-delivery="release"]').disabled = delivery?.ci_status !== "passed";
    el("delivery-status").textContent = delivery
      ? [delivery.sha, delivery.pr_url, delivery.ci_status && "CI " + delivery.ci_status, delivery.release_approved && "릴리스 후보 승인됨"]
        .filter(Boolean).join(" · ") : "";
    stageForm.hidden = !delivery?.release_approved;
    stageForm.elements.environment.disabled = Boolean(deployment);
    if (deployment) stageForm.elements.environment.value = deployment.environment;
    stageForm.querySelector("button").textContent = deployment ? "테스트 배포 상태 확인" : "테스트 배포 승인 및 요청";
    el("staging-status").textContent = deployment
      ? [deployment.environment, deployment.state, deployment.conclusion, deployment.url].filter(Boolean).join(" · ") : "";
    actions.querySelector('[data-action="pause"]').disabled = status !== "running";
    actions.querySelector('[data-action="resume"]').disabled = !["paused", "interrupted"].includes(status) ||
      detail?.nodes.some((node) => node.status === "interrupted");
    actions.querySelector('[data-action="cancel"]').disabled =
      !["queued", "running", "paused", "waiting_approval", "interrupted"].includes(status);
    el("run-status").textContent = detail ? [status, detail.run.error, detail.run.workspace].filter(Boolean).join(" · ") : "";
    el("timeline").replaceChildren(...(detail?.timeline ?? []).map(({ created, kind, payload }) => {
      const event = document.createElement("li");
      event.textContent = [new Date(created).toLocaleTimeString(), kind, detail.labels[payload.node], payload.status].filter(Boolean).join(" · ");
      return event;
    }));
    const nextResults = detail ? JSON.stringify([detail.run.id, status, detail.nodes, detail.retries]) : "";
    if (nodeResultsVersion === nextResults) return;
    nodeResultsVersion = nextResults;
    el("run-nodes").replaceChildren(...(detail?.nodes ?? []).map((node) => {
      const item = document.createElement("li");
      item.dataset.node = node.node;
      const heading = document.createElement("strong");
      heading.textContent = (detail.labels[node.node] ?? node.node) + " · " + node.status;
      item.append(heading);
      if (status === "failed" && node.status === "failed" && node.outcome?.passed === false && !node.outcome?.interrupted) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "이 노드 재시도";
        retry.onclick = report(async () => {
          await request("workflow-runs/retry", {}, { id: detail.run.id, node: node.node });
          await refresh();
        });
        item.append(retry);
      }
      if (node.outcome) {
        const source = harnessProvenance(node.outcome.definitions, node.outcome.attempts ?? []);
        if (source) item.append(source);
        const details = document.createElement("pre");
        details.textContent = JSON.stringify(node.outcome, null, 2);
        item.append(details);
      }
      for (const retry of detail.retries.filter((retry) => retry.node === node.node)) {
        const history = document.createElement("details"), summary = document.createElement("summary"), output = document.createElement("pre");
        summary.textContent = "이전 실패 " + retry.attempt;
        output.textContent = JSON.stringify(retry.outcome, null, 2);
        history.append(summary, output);
        item.append(history);
      }
      return item;
    }));
    focus();
  }

  runForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const workflow = current();
    if (submitting || !workflow) return;
    const form = new FormData(runForm);
    const input = { project: projectId(), workflow: workflow.id, version: workflow.version, title: form.get("title"),
      timeoutMs: Number(form.get("minutes")) * 60000, budgetCents: Number(form.get("budget")) };
    const identity = JSON.stringify(input);
    if (pending?.identity !== identity) pending = { identity, key: crypto.randomUUID() };
    submitting = submitRun.disabled = true;
    launchStatus.textContent = "";
    try {
      const run = await request("workflow-runs", {}, { ...input, key: pending.key });
      await refresh(run.id);
      pending = null;
      runForm.elements.title.value = "";
      dialog.close();
    } catch (error) {
      launchStatus.textContent = error.message;
    } finally {
      submitting = submitRun.disabled = false;
    }
  });
  list.addEventListener("change", report(async () => refresh()));
  deliveryForm.addEventListener("submit", report(async () => {
    if (!selected) return;
    await request("workflow-delivery/approve", {}, { id: selected.run.id, branch: deliveryForm.elements.branch.value });
    await refresh();
  }));
  deliveryActions.addEventListener("click", report(async (event) => {
    if (!selected || !event.target.dataset.delivery) return;
    await request("workflow-delivery/" + event.target.dataset.delivery, {}, { id: selected.run.id });
    await refresh();
  }));
  stageForm.addEventListener("submit", report(async () => {
    if (!selected) return;
    await request("workflow-delivery/staging", {}, { id: selected.run.id, environment: stageForm.elements.environment.value });
    await refresh();
  }));
  el("review").onclick = report(async () => {
    if (!selected) return;
    const id = selected.run.id;
    const result = await request("workflow-review", { id });
    if (selected?.run.id !== id) return;
    const output = el("review-output");
    output.textContent = [result.status, result.diff, result.truncated ? "일부 변경사항만 표시됩니다." : ""]
      .filter(Boolean).join("\n\n") || "변경사항이 없습니다.";
    output.hidden = false;
  });
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
    if (submitting || refreshing || explicitRefreshes || document.getElementById("workflow").hidden || !projectId()) return;
    refreshing = true;
    try { await load(list.value); } catch { /* the next poll retries */ } finally { refreshing = false; }
  }, 1800);
  return { refresh, focus };
}
