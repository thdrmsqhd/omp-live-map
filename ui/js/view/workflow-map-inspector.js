function paintWorkflowMap() {
  const detail = wfMap.run, graph = detail.graph;
  $("workflow-layer").hidden = $("workflow-inspector").hidden = false;
  $("wf-map-title").textContent = detail.run.title;
  $("wf-map-version").textContent = wfMap.edit ? "Workflow 편집 · v" + wfMap.edit.record.version + " 기준" : graph.name + " · v" + detail.run.version;
  $("wf-map-engineering").href = "/?" + new URLSearchParams({ mode: "design", project: detail.run.project, workflow: detail.run.workflow });
  if (!wfMap.edit) $("wf-map-status").textContent = [wfLabel(detail.run.status), detail.run.error, wfMap.notice].filter(Boolean).join(" · ");
  const executions = new Map((wfMap.edit ? [] : detail.nodes).map((item) => [item.node, item]));
  const live = wfMap.edit ? {} : detail.live ?? {};
  const root = $("workflow-map-nodes");
  for (const node of wfNodes()) {
    let button = wfMap.buttons.get(node.id);
    if (!button) {
      button = wfCreateNode(node);
      wfMap.buttons.set(node.id, button);
      root.append(button);
    }
    const p = wfPoint(node);
    button.style.left = p.x + "px";
    button.style.top = p.y + "px";
    button.setAttribute("aria-pressed", String(node.id === wfMap.selected));
    wfPaintNode(button, node, executions.get(node.id), live[node.id]);
  }
  $("workflow-layer").dataset.running = String(!wfMap.edit && detail.run.status === "running");
  wfPaintEdges();
  paintMinimap();
  wfPaintNodeActions(executions);
  wfPaintFollow();

  paintWorkflowRunControls();
  if (wfMap.edit) { $("wf-map-live").hidden = true; return; }
  const step = graph.nodes.find(({ id }) => id === wfMap.selected);
  const state = executions.get(wfMap.selected);
  const previous = detail.retries.filter(({ node }) => node === wfMap.selected);
  paintWorkflowLive(step, state, live[wfMap.selected]);
  paintWorkflowEvidence(step, state, previous);
  paintUnifiedTimeline(detail);
  window.UnifiedWorkflow?.paint();
}

let unifiedTimelineSignature;
function paintUnifiedTimeline(detail) {
  const list = $("unified-run-timeline");
  if (!list) return;
  list.hidden = !detail;
  const signature = detail && JSON.stringify([detail.run.id, wfMap.selected, detail.nodes.map(item => [item.node, item.status, item.updated, item.outcome?.artifacts?.length])]);
  if (signature === unifiedTimelineSignature) return;
  unifiedTimelineSignature = signature;
  list.replaceChildren(...(detail?.nodes ?? []).filter(item => detail.labels?.[item.node]).map(item => {
    const row = wfText("li", "");
    const label = detail.labels[item.node];
    const count = item.outcome?.artifacts?.length;
    const control = wfActionButton(label + " · " + wfLabel(item.status) + (count ? " · 산출물 " + count + "개" : ""), () => {
      wfMap.selected = item.node; wfStopFollow(); paintWorkflowMap();
      $("wf-map-title").focus({ preventScroll: true });
    });
    control.setAttribute("aria-pressed", String(item.node === wfMap.selected));
    row.append(control);
    return row;
  }));
}

// 선택한 단계가 실행 중이면 지금 보내는 프롬프트의 구성과 에이전트의 실시간 출력을 보여 준다.
function paintWorkflowLive(node, execution, live) {
  const panel = $("wf-map-live");
  const running = execution?.status === "running";
  panel.hidden = !node || !running;
  if (panel.hidden) { panel.replaceChildren(); return; }
  if (panel.dataset.node !== node.id || !panel.firstChild) {
    panel.dataset.node = node.id;
    const phase = wfText("p", "", "wf-phase");
    const bar = wfText("span", "", "wf-bar");
    const legend = wfText("p", "", "wf-legend");
    const task = document.createElement("details");
    task.open = mapMode === "design";
    task.append(wfText("summary", "작업 지시"), wfText("pre", ""));
    const stream = wfText("pre", "", "wf-live-stream");
    const tools = wfText("p", "", "wf-tools");
    const head = wfText("div", "", "wf-live-head");
    head.append(wfText("h3", "지금 실행 중인 프롬프트"), wfTranscriptButton(node) ?? "");
    panel.replaceChildren(head, phase, bar, legend, task, stream, tools);
  }
  const [, phase, bar, legend, task, stream, tools] = panel.children;
  const started = live?.startedAt ?? execution.updated ?? Date.now();
  phase.dataset.started = String(started);
  phase.dataset.label = [wfPhases[live?.phase] ?? "실행 중", live?.attempts > 1 ? "시도 " + Math.max(1, live.attempt) + "/" + live.attempts : "",
    live?.chars ? "프롬프트 " + live.chars.toLocaleString() + "자" : ""].filter(Boolean).join(" · ");
  phase.textContent = phase.dataset.label + " · " + wfClock(Date.now() - started);
  wfPaintBar(bar, live?.sections ?? []);
  legend.replaceChildren(...(live?.sections ?? []).map(({ name, chars }) => {
    const item = wfText("span", (wfSectionNames[name] ?? name) + " " + chars.toLocaleString());
    item.dataset.section = name;
    return item;
  }));
  legend.hidden = !live?.sections?.length;
  const instruction = node.type === "approval" ? node.prompt : node.instruction;
  task.hidden = !instruction;
  task.lastChild.textContent = instruction ?? "";
  const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 24;
  stream.textContent = live?.text?.trim() || (node.type === "command" ? "명령 출력은 끝난 뒤 검증 기록에 남습니다." : "에이전트 응답을 기다리는 중입니다.");
  stream.append(wfText("span", "", "wf-caret"));
  if (nearBottom) stream.scrollTop = stream.scrollHeight;
  tools.replaceChildren(...(live?.tools ?? []).map((tool) => wfText("span", tool, tool === live.tool ? "is-current" : "")));
  tools.hidden = !live?.tools?.length;
}

let wfEvidenceSignature;
function paintWorkflowEvidence(node, execution, history) {
  const frame = $("wf-map-details");
  const run = wfMap.run.run;
  const signature = JSON.stringify([run.id, run.status, run.workspace, node, execution, history, wfMap.run.interventions?.[node?.id]]);
  if (signature === wfEvidenceSignature) return;
  wfEvidenceSignature = signature;
  frame.replaceChildren();
  if (!node) return;
  frame.append(wfText("h3", node.label + " · " + wfLabel(execution?.status)));
  // 끝난 단계도 작업 지시 수행 내역(출력·도구 호출)을 큰 창으로 다시 볼 수 있다.
  if (execution && execution.status !== "running") {
    const open = wfTranscriptButton(node);
    if (open) frame.append(open);
  }
  const instruction = node.type === "approval" ? node.prompt : node.instruction;
  if (instruction && execution?.status !== "running") {
    const task = wfText("section", "", "wf-step-instruction");
    task.append(wfText("h4", "작업 지시"), wfText("pre", instruction));
    frame.append(task);
  }
  const outcome = execution?.outcome ?? {};
  if (run.workspace) frame.append(workflowEvidencePreview("작업 공간 변경분", "workflow-review", { id: run.id }));
  for (const { path, sha256 } of outcome.artifacts ?? []) {
    const section = workflowEvidencePreview("산출물 " + path, "workflow-artifact", { id: run.id, node: node.id, path });
    section.append(wfText("small", sha256));
    frame.append(section);
  }
  if (outcome.error) frame.append(wfText("p", outcome.error));
  if (outcome.prompt && outcome.prompt !== instruction) frame.append(wfText("p", instruction && outcome.prompt.startsWith(instruction + "\n\n") ? outcome.prompt.slice(instruction.length + 2) : outcome.prompt));
  const definitions = outcome.definitions;
  if (definitions) frame.append(wfText("p", definitions.harness.name + " v" + definitions.harness.version +
    " · " + definitions.model.name + " v" + definitions.model.version));
  const evidence = [
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
  paintWorkflowInterventions(frame, node, execution, run);
}

function workflowEvidencePreview(label, endpoint, params) {
  const section = document.createElement("details"), summary = wfText("summary", label);
  section.append(summary);
  section.addEventListener("toggle", async () => {
    if (!section.open || section.querySelector("pre")) return;
    const content = wfText("pre", "불러오는 중…");
    section.append(content);
    try {
      const result = await mapWorkflowRequest(endpoint, params);
      content.textContent = [result.status, result.diff, result.text, result.truncated && "표시 범위를 초과한 내용이 있습니다."]
        .filter(Boolean).join("\n\n") || "표시할 내용이 없습니다.";
    } catch (error) {
      content.textContent = error.message;
      section.addEventListener("toggle", () => { if (!section.open) content.remove(); }, { once: true });
    }
  });
  return section;
}

function wfActionButton(label, action) {
  const button = wfText("button", label);
  button.type = "button";
  button.onclick = action;
  return button;
}

async function wfPerform(button, endpoint, extra) {
  if (wfMap.opening || wfMap.intervening) return;
  wfMap.intervening = true;
  const generation = ++wfMap.generation, id = wfMap.run.run.id;
  button.disabled = true;
  try {
    await mapWorkflowRequest(endpoint, {}, { id, ...extra });
    void refreshWorkflowQueue();
    const detail = await mapWorkflowRequest("workflow-run", { id });
    if (wfMap.generation === generation) wfAccept(detail, false);
  } catch (error) {
    if (wfMap.generation === generation) {
      const status = $("wf-map-intervention-status") ?? $("wf-map-status");
      status.textContent = error.message;
    }
  } finally {
    wfMap.intervening = false;
    button.disabled = false;
  }
}

function paintWorkflowInterventions(frame, node, execution, run) {
  const options = wfMap.run.interventions?.[node.id];
  const approval = run.status === "waiting_approval" && execution?.status === "waiting_approval";
  if (!options && !approval) return;
  const actions = document.createElement("div");
  actions.className = "wf-actions";
  const retry = (button, mode, extra) => wfPerform(button, "workflow-runs/retry", { node: node.id, mode, ...extra });
  if (options) {
    actions.append(wfActionButton(options.verify ? "검증만 재실행" : "선택 단계 재실행",
      ({ currentTarget }) => retry(currentTarget, options.verify ? "verify" : "retry")));
    if (options.rework.length) {
      const box = document.createElement("details");
      box.append(wfText("summary", "수정 요청"));
      const label = wfText("label", "다시 실행할 단계");
      const target = document.createElement("select");
      target.append(...options.rework.map(({ id, label }) => new Option(label, id)));
      label.append(target);
      const request = wfText("label", "추가 요청 사항");
      const notes = document.createElement("textarea");
      notes.rows = 3;
      notes.maxLength = 2000;
      request.append(notes);
      box.append(label, request, wfActionButton("실패 근거를 넘겨 다시 실행",
        ({ currentTarget }) => retry(currentTarget, "rework", { restart: target.value, note: notes.value })));
      frame.append(box);
    }
  }
  if (approval && (node.gate || execution?.outcome?.gate)) {
    frame.append(wfText("p", "원래 창에서 직접 처리하세요. 아래 버튼은 Workflow 진행 상태만 바꿉니다."));
    for (const [decision, label] of [["approved", "직접 처리 완료"], ["rejected", "진행하지 않음"]]) {
      actions.append(wfActionButton(label, ({ currentTarget }) => wfPerform(currentTarget, "workflow-runs/approval", { node: node.id, decision })));
    }
  } else if (approval) {
    const label = wfText("label", "승인 메모 또는 반려 사유");
    const reason = document.createElement("textarea");
    reason.rows = 3;
    reason.maxLength = 2000;
    label.append(reason);
    frame.append(label);
    for (const [decision, label] of [["approved", "승인"], ["rejected", "반려"]]) {
      actions.append(wfActionButton(label, ({ currentTarget }) => {
        if (decision === "rejected" && !reason.value.trim()) {
          $("wf-map-intervention-status").textContent = "반려 사유를 입력해 주세요.";
          reason.focus();
          return;
        }
        return wfPerform(currentTarget, "workflow-runs/approval", { node: node.id, decision, reason: reason.value });
      }));
    }
  }
  const status = wfText("p", "");
  status.id = "wf-map-intervention-status";
  status.setAttribute("role", "status");
  frame.append(actions, status);
}
