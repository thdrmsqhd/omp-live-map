const wfEditStatus = $("wf-edit-status");
const wfEditFields = $("wf-edit-fields");
const wfEditName = $("wf-edit-name");
const wfEditFrom = $("wf-edit-from");
const wfEditTo = $("wf-edit-to");
const wfEditPort = $("wf-edit-port");
let wfEditRender = 0;

function wfEditReport(error) {
  wfEditStatus.textContent = error.message;
  const terms = new Set(error.message.match(/[a-zA-Z0-9_-]+/g) ?? []);
  for (const [id, button] of wfMap.buttons) button.toggleAttribute("data-invalid", terms.has(id));
}
function wfClearDiagnostics() {
  for (const button of wfMap.buttons.values()) button.removeAttribute("data-invalid");
}
function wfDraftSignature(draft) { return JSON.stringify([draft.payload, draft.loops]); }

function wfAllowLeave() {
  const draft = wfMap.edit;
  return !draft || (!draft.fieldsDirty && draft.initial === wfDraftSignature(draft)) ||
    window.confirm("저장하지 않은 Workflow 변경을 버리시겠습니까?");
}

function wfClearButtons() {
  wfMap.buttons.clear();
  $("workflow-map-nodes").replaceChildren();
  wfEdgeSignature = undefined;
}

function wfLeaveEditing(force = false) {
  if (!force && !wfAllowLeave()) return false;
  const draft = wfMap.edit;
  if (!draft) return true;
  wfMap.edit = null;
  wfEditRender += 1;
  $("wf-map-edit-controls").hidden = true;
  $("wf-map-details").hidden = false;
  $("wf-map-edit").hidden = false;
  wfMap.selected = draft.previousNode;
  wfClearButtons();
  paintWorkflowMap();
  return true;
}

function wfSelectEditNode(id) {
  const draft = wfMap.edit;
  if (!draft || id === wfMap.selected) return true;
  if (draft.fieldsDirty && !window.confirm("노드 폼의 미적용 변경을 버리시겠습니까?")) return false;
  wfMap.selected = id;
  draft.fieldsDirty = false;
  void wfRenderEditFields().catch(wfEditReport);
  return true;
}

function wfReplaceOptions(control, items, preferred = control.value) {
  control.replaceChildren(...items);
  if ([...control.options].some(({ value }) => value === preferred)) control.value = preferred;
}

function wfPortOptions() {
  const node = wfNodes().find(({ id }) => id === wfEditFrom.value);
  wfReplaceOptions(wfEditPort, (wfEditPorts[node?.type] ?? ["next"]).map((port) => wfOption(port,
    { next: "다음", true: "조건 충족", false: "조건 불충족", approved: "승인", rejected: "반려" }[port])));
}

function wfRenderConnections() {
  const graph = wfMap.edit.payload;
  wfReplaceOptions(wfEditFrom, graph.nodes.filter(({ type }) => !["end", "profile"].includes(type)).map(({ id, label }) => wfOption(id, label)));
  wfReplaceOptions(wfEditTo, graph.nodes.filter(({ type }) => !["start", "profile"].includes(type)).map(({ id, label }) => wfOption(id, label)));
  wfPortOptions();
  const label = (id) => graph.nodes.find((node) => node.id === id)?.label ?? id;
  $("wf-edit-edges").replaceChildren(...graph.edges.map((edge, index) => {
    const row = wfText("li", label(edge.from) + " → " + label(edge.to) + " · " + edge.port);
    row.append(wfActionButton("연결 삭제", () => {
      graph.edges.splice(index, 1);
      wfRenderConnections();
      wfPaintEdges();
    }));
    return row;
  }));
}

async function wfRenderEditFields() {
  const revision = ++wfEditRender;
  const draft = wfMap.edit;
  const node = draft.payload.nodes.find(({ id }) => id === wfMap.selected);
  wfEditFields.replaceChildren();
  if (!node) return;
  const form = await wfStepForm(node, draft, (replacement, attempts) => {
    if (attempts !== undefined) {
      if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 8) throw new Error("시도 횟수는 1~8회여야 합니다.");
      draft.loops[node.id] = attempts;
    }
    Object.assign(node, replacement);
    draft.fieldsDirty = false;
    wfEditStatus.textContent = "노드 변경이 초안에 반영됐습니다.";
    wfRenderConnections();
    paintWorkflowMap();
  });
  if (revision !== wfEditRender || draft !== wfMap.edit) return;
  wfEditFields.replaceChildren(form);
  if (!["start", "end"].includes(node.type)) wfEditFields.append(wfActionButton("노드 삭제", () => {
    draft.payload.nodes = draft.payload.nodes.filter(({ id }) => id !== node.id);
    draft.payload.edges = draft.payload.edges.filter(({ from, to }) => from !== node.id && to !== node.id);
    for (const other of draft.payload.nodes) other.inputs = (other.inputs ?? []).filter(({ source }) => source !== node.id);
    delete draft.loops[node.id];
    wfMap.buttons.get(node.id)?.remove();
    wfMap.buttons.delete(node.id);
    wfMap.selected = null;
    draft.fieldsDirty = false;
    wfEditFields.replaceChildren();
    wfRenderConnections();
    paintWorkflowMap();
  }));
}

function wfAddStage(type) {
  const draft = wfMap.edit, id = crypto.randomUUID();
  if (!wfSelectEditNode(id)) return;
  const center = $("stage").getBoundingClientRect();
  const point = worldPoint(center.left + center.width / 3, center.top + center.height / 2);
  const coord = (value) => Math.max(0, Math.min(10000, Math.round(value)));
  const node = { id, type, label: wfEditTypes[type], x: coord((point.x - wfMap.origin.x) / wfScale.x), y: coord((point.y - wfMap.origin.y) / wfScale.y) };
  for (const key of ["agent", "loop"]) if (type === key) Object.assign(node, { definition: "", instruction: "" });
  if (type === "command") node.check = { command: "node", args: ["--test"], code: 0 };
  if (type === "approval") node.prompt = "";
  if (type === "condition") Object.assign(node, { source: "", field: "passed", equals: true });
  draft.payload.nodes.push(node);
  wfMap.selected = id;
  wfRenderConnections();
  void wfRenderEditFields().catch(wfEditReport);
  paintWorkflowMap();
}

async function wfOpenEditor() {
  if (wfMap.opening) return;
  if (!wfMap.run || wfMap.edit) return;
  const opened = wfMap.run.run, generation = wfMap.generation;
  const button = $("wf-map-edit");
  button.disabled = true;
  try {
    const [record, definitions, workflows] = await Promise.all([
      mapWorkflowRequest("workflow", { project: opened.project, id: opened.workflow }),
      mapWorkflowRequest("definitions", { project: opened.project }),
      mapWorkflowRequest("workflows", { project: opened.project }),
    ]);
    if (generation !== wfMap.generation || wfMap.run?.run.id !== opened.id) return;
    const draft = { record, payload: structuredClone(record.payload), definitions, workflows, loops: {},
      previousNode: wfMap.selected, fieldsDirty: false, saving: false };
    const defaults = wfDefaultPositions(draft.payload.nodes);
    for (const node of draft.payload.nodes) {
      const position = defaults.get(node.id);
      if (position && position.x <= 10000) Object.assign(node, position);
    }
    draft.initial = wfDraftSignature(draft);
    wfMap.edit = draft;
    wfMap.selected = draft.payload.nodes.some(({ id }) => id === wfMap.selected) ? wfMap.selected : draft.payload.nodes[0]?.id;
    if (wfMap.selected) writeJSON("omp-workflow-map-selection", { id: opened.id, node: wfMap.selected });
    wfClearButtons();
    $("wf-map-details").hidden = $("wf-map-edit").hidden = true;
    $("wf-map-edit-controls").hidden = false;
    wfEditName.value = record.name;
    wfEditStatus.textContent = record.version !== opened.version ? "현재 실행은 v" + opened.version +
      "입니다. 편집은 최신 v" + record.version + "에서 시작합니다." : "";
    wfRenderConnections();
    await wfRenderEditFields();
    paintWorkflowMap();
  } catch (error) { $("wf-map-status").textContent = error.message; }
  finally { button.disabled = false; }
}

async function wfSubmitEdit(save) {
  const draft = wfMap.edit;
  if (!draft || draft.saving) return;
  if (draft.fieldsDirty) return wfEditReport(new Error("현재 노드의 폼에서 ‘노드 적용’을 먼저 누르세요."));
  const actions = [$("wf-edit-validate"), $("wf-edit-save"), $("wf-edit-discard")];
  draft.saving = true;
  actions.forEach((button) => { button.disabled = true; });
  const data = { id: draft.record.id, project: draft.record.project, version: draft.record.version, payload: draft.payload,
    loops: Object.entries(draft.loops).map(([node, attempts]) => ({ node, attempts })) };
  try {
    const result = await mapWorkflowRequest(save ? "workflows/save-canvas" : "workflows/plan", {}, data);
    if (wfMap.edit !== draft) return;
    if (!save) {
      const labels = new Map(result.document.nodes.map(({ id, label }) => [id, label]));
      wfClearDiagnostics();
      wfEditStatus.textContent = "검사 통과 · " + result.order.map((id) => labels.get(id)).join(" → ");
      return;
    }
    wfLeaveEditing(true);
    wfMap.notice = "Workflow v" + result.version + " 저장됨 · 이 실행은 v" + wfMap.run.run.version + "입니다.";
    $("wf-map-status").textContent = wfMap.notice;
  } catch (error) { if (wfMap.edit === draft) wfEditReport(error); }
  finally {
    draft.saving = false;
    actions.forEach((button) => { button.disabled = false; });
  }
}

$("wf-map-edit").onclick = () => void wfOpenEditor();
$("wf-edit-discard").onclick = () => wfLeaveEditing();
$("wf-edit-validate").onclick = () => void wfSubmitEdit(false);
$("wf-edit-save").onclick = () => void wfSubmitEdit(true);
$("wf-edit-from").onchange = wfPortOptions;
wfEditName.oninput = () => { wfMap.edit.payload.name = wfEditName.value; };
$("wf-edit-palette").append(...Object.entries(wfEditTypes).map(([key, label]) => wfActionButton(label, () => wfAddStage(key))));
$("wf-edit-connect").onclick = () => {
  const draft = wfMap.edit, from = wfEditFrom.value, to = wfEditTo.value, port = wfEditPort.value;
  if (!from || !to || from === to) return wfEditReport(new Error("서로 다른 출발·도착 노드를 선택해 주세요."));
  if (draft.payload.edges.some((edge) => edge.from === from && edge.to === to && edge.port === port)) {
    return wfEditReport(new Error("이미 연결된 경로입니다."));
  }
  draft.payload.edges.push({ from, to, port });
  wfRenderConnections();
  wfPaintEdges();
};
