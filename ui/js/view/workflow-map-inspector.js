function paintWorkflowMap() {
  const detail = wfMap.run, graph = detail.graph;
  $("workflow-layer").hidden = $("workflow-inspector").hidden = false;
  $("wf-map-title").textContent = detail.run.title;
  $("wf-map-version").textContent = graph.name + " · v" + detail.run.version;
  $("wf-map-engineering").href = "/engineering.html?" + new URLSearchParams({
    project: detail.run.project, view: "workflow", run: detail.run.id,
  });
  $("wf-map-status").textContent = wfLabel(detail.run.status) + (detail.run.error ? " · " + detail.run.error : "");
  const executions = new Map(detail.nodes.map((item) => [item.node, item]));
  const root = $("workflow-map-nodes");
  for (const node of graph.nodes) {
    let button = wfMap.buttons.get(node.id);
    if (!button) {
      button = wfCreateNode(node);
      wfMap.buttons.set(node.id, button);
      root.append(button);
    }
    const p = wfPoint(node), status = executions.get(node.id)?.status;
    button.style.left = p.x + "px";
    button.style.top = p.y + "px";
    button.dataset.status = status ?? "queued";
    button.setAttribute("aria-pressed", String(node.id === wfMap.selected));
    button.lastChild.textContent = wfLabel(status);
  }
  wfPaintEdges();
  paintMinimap();

  const step = graph.nodes.find(({ id }) => id === wfMap.selected);
  const state = executions.get(wfMap.selected);
  const previous = detail.retries.filter(({ node }) => node === wfMap.selected);
  paintWorkflowEvidence(step, state, previous);
}

let wfEvidenceSignature;
function paintWorkflowEvidence(node, execution, history) {
  const frame = $("wf-map-details");
  const signature = JSON.stringify([wfMap.run.run.id, node, execution, history]);
  if (signature === wfEvidenceSignature) return;
  wfEvidenceSignature = signature;
  frame.replaceChildren();
  if (!node) return;
  frame.append(wfText("h3", node.label + " · " + wfLabel(execution?.status)));
  const outcome = execution?.outcome;
  if (!outcome) return;
  if (outcome.error) frame.append(wfText("p", outcome.error));
  if (outcome.prompt) frame.append(wfText("p", outcome.prompt));
  const definitions = outcome.definitions;
  if (definitions) frame.append(wfText("p", definitions.harness.name + " v" + definitions.harness.version +
    " · " + definitions.model.name + " v" + definitions.model.version));
  const evidence = [
    ...(outcome.artifacts ?? []).map(({ path, sha256 }) => ["산출물 " + path, sha256]),
    ...(outcome.checks ?? []).map((check) => [check.command + " · " + (check.passed ? "통과" : "실패"), check.log]),
    ...(outcome.attempts ?? []).map((attempt, index) => ["시도 " + (index + 1) + (attempt.sessionId ? " · 세션 " + attempt.sessionId : ""),
      JSON.stringify(attempt, null, 2)]),
    ...history.map((item) => ["이전 시도 " + item.attempt, JSON.stringify(item.outcome, null, 2)]),
  ];
  for (const [label, text] of evidence) {
    const detail = document.createElement("details");
    detail.append(wfText("summary", label));
    if (text) detail.append(wfText("pre", text));
    frame.append(detail);
  }
}
