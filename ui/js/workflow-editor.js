import { bindWorkflowCanvas, nodeWidth, nodeHeight } from "./workflow-canvas.js";
import { bindWorkflowHarness } from "./workflow-harness.js";
import { bindWorkflowRuns } from "./workflow-runs.js";
import { bindTemplateButtons } from "./workflow-templates.js";

const types = {
  start: "Start", end: "End", agent: "Agent", command: "Command", loop: "Loop",
  condition: "Condition", parallel: "Parallel", join: "Join", approval: "Approval", subgraph: "Subgraph",
};
const ports = { end: [], condition: ["true", "false"], approval: ["approved", "rejected"] };
const outputOf = (type) => ports[type] ?? ["next"];
const inputY = 54;
const portY = (type, port) => outputOf(type).length === 1 ? inputY : 54 + 22 * outputOf(type).indexOf(port);
const portLabels = { next: "다음", true: "참", false: "거짓", approved: "승인", rejected: "거절" };
const statusLabels = {
  queued: "대기", running: "실행 중", waiting_approval: "승인 대기", succeeded: "완료",
  failed: "실패", skipped: "건너뜀", interrupted: "중단", paused: "일시정지", canceled: "취소",
};
const graphHint = "빈 공간 드래그로 이동 · Ctrl+휠로 확대·축소 · 출력 포트를 끌거나 선택해 입력에 연결";
const bound = (value) => Math.min(10000, Math.max(0, Math.round(value)));
const blank = () => ({ name: "", nodes: [
  { id: "start", type: "start", label: "Start", x: 45, y: 70 },
  { id: "end", type: "end", label: "End", x: 460, y: 70 },
], edges: [] });

function choices(select, entries, fallback) {
  const previous = select.value;
  select.replaceChildren(...entries.map(([key, label]) => new Option(label, key)));
  if (entries.some(([key]) => key === previous)) select.value = previous;
  else if (fallback !== undefined) select.value = fallback;
}

export function bindWorkflow({ find, request, report, definitions, editHarness }) {
  const el = (name) => find("workflow-" + name);
  const selector = el("list"), form = el("node-form");
  let project = "", workflow, selected, documentState = blank(), runDetail, workflows = [];
  let runNode, connection, preview;
  const graph = () => runDetail?.graph ?? documentState;
  const canvas = bindWorkflowCanvas(el, () => setConnection(null));
  let pendingFit;
  const fit = () => { pendingFit = !canvas.fit(graph().nodes); };
  el("fit").onclick = fit;
  new ResizeObserver(() => { if (pendingFit) fit(); }).observe(el("viewport"));
  const harness = bindWorkflowHarness({ el, form, definitions, choices, editHarness: (id, version) => report(() => editHarness(id, version))() });
  const runs = bindWorkflowRuns({ el, request, report, current: () => runDetail ? {
      id: runDetail.run.workflow, version: runDetail.run.version, name: runDetail.graph?.name ?? runDetail.run.title,
    } : workflow, projectId: () => project,
    focusedNode: () => runNode,
    onStatus(detail) {
      const changed = detail?.run.id !== runDetail?.run.id;
      runDetail = detail;
      if (changed) {
        runNode = null;
        setConnection(null);
        render();
        fit();
      } else showRunStates();
    },
  });
  bindTemplateButtons({ el, request, report, definitions, current: () => workflow, projectId: () => project, async imported(record) {
    await loadList(record.project);
    if (record.project !== project) return;
    if (runDetail) await runs.refresh("");
    if (record.project === project) {
      selector.value = record.id;
      open(record);
    }
  } });
  choices(el("type"), Object.entries(types).filter(([type]) => !["start", "end"].includes(type)));
  function draw() {
    const { nodes, edges } = graph();
    const lines = el("lines");
    const positions = new Map(nodes.map((node) => [node.id, node]));
    const states = new Map((runDetail?.nodes ?? []).map((node) => [node.node, node]));
    const paths = [];
    function wire(x1, y1, x2, y2, state) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const bend = Math.max(45, Math.abs(x2 - x1) * .48);
      path.setAttribute("d", `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`);
      if (state) path.dataset.state = state;
      paths.push(path);
    }
    for (const { from, to, port } of edges) {
      const start = positions.get(from), target = positions.get(to);
      if (!start || !target) continue;
      const source = states.get(from), destination = states.get(to);
      const active = source?.status === "succeeded" && (source.outcome?.port ?? "next") === port &&
        destination && destination.status !== "skipped";
      wire(start.x + nodeWidth, start.y + portY(start.type, port), target.x, target.y + inputY,
        runDetail ? (active ? "active" : "inactive") : port);
    }
    const source = connection && positions.get(connection.from);
    if (source && preview) {
      wire(source.x + nodeWidth, source.y + portY(source.type, connection.port), preview.x, preview.y, "preview");
    }
    lines.replaceChildren(...paths);
  }
  function setConnection(next, message) {
    connection = next;
    preview = null;
    for (const output of el("nodes").querySelectorAll("[data-port]")) {
      output.setAttribute("aria-pressed", String(Boolean(next && output.dataset.port === next.port &&
        output.closest(".workflow-node").dataset.node === next.from)));
    }
    el("viewport").classList.toggle("is-connecting", Boolean(next));
    const source = next && documentState.nodes.find(({ id }) => id === next.from);
    el("graph-help").textContent = message ?? (source
      ? `${source.label} · ${portLabels[next.port]} → 입력 포트를 선택하세요. Esc로 취소`
      : runDetail ? "노드를 선택하면 해당 단계의 실행 결과를 볼 수 있습니다." : graphHint);
    draw();
  }
  function connect({ from, to, port }) {
    const source = documentState.nodes.find(({ id }) => id === from);
    const target = documentState.nodes.find(({ id }) => id === to);
    if (!source || !target || from === to || target.type === "start" || !outputOf(source.type).includes(port)) {
      setConnection(connection, "서로 다른 노드의 출력과 입력을 연결하세요.");
      return;
    }
    if (documentState.edges.some((edge) => edge.from === from && edge.to === to && edge.port === port)) {
      setConnection(null, "이미 연결된 포트입니다.");
      return;
    }
    documentState.edges.push({ from, to, port });
    setConnection(null, `${source.label} → ${target.label} 연결됨`);
    renderEdges();
  }
  function portButton(node, port) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workflow-port";
    const caption = portLabels[port] ?? "입력";
    button.textContent = caption;
    button.style.top = (port ? portY(node.type, port) : inputY) + "px";
    button.dataset.direction = port ? "output" : "input";
    button.setAttribute("aria-label", node.label + " · " + (port ? caption + " 출력" : caption));
    if (!port) {
      button.dataset.input = node.id;
      button.onclick = () => {
        if (connection) connect({ ...connection, to: node.id });
        else setConnection(null, "연결할 출력 포트를 먼저 선택하세요.");
      };
      return button;
    }
    const start = { from: node.id, port };
    button.dataset.port = port;
    button.setAttribute("aria-pressed", "false");
    button.onclick = (event) => {
      if (event.detail === 0) setConnection(start);
    };
    button.onpointerdown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      button.setPointerCapture(event.pointerId);
      setConnection(start);
    };
    button.onpointermove = (event) => {
      if (!button.hasPointerCapture(event.pointerId) || connection !== start) return;
      preview = canvas.point(event.clientX, event.clientY);
      draw();
    };
    button.onpointerup = (event) => {
      if (!button.hasPointerCapture(event.pointerId) || connection !== start) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-input]");
      if (target) connect({ ...start, to: target.dataset.input });
      else setConnection(start);
    };
    button.onpointercancel = () => setConnection(null);
    return button;
  }
  function nodeCard(node) {
    const card = document.createElement("div"), button = document.createElement("button");
    const label = document.createElement("strong"), state = document.createElement("small");
    card.className = "workflow-node";
    card.dataset.node = node.id;
    card.dataset.type = node.type;
    button.className = "workflow-node-title";
    button.type = "button";
    button.setAttribute("aria-pressed", String((runDetail ? runNode : selected) === node.id));
    label.textContent = node.label;
    button.title = node.label;
    state.textContent = types[node.type];
    button.append(label, state);
    card.append(button);
    const position = () => { card.style.left = node.x + "px"; card.style.top = node.y + "px"; };
    position();
    card.addEventListener("click", (event) => {
      if (event.target.closest(".workflow-port")) return;
      if (runDetail) {
        runNode = runNode === node.id ? null : node.id;
        runs.focus();
      } else {
        if (selected === node.id) return;
        selected = node.id;
        showInspector();
      }
      showSelection();
    });
    if (runDetail) return card;
    if (node.type !== "start") card.append(portButton(node));
    for (const port of outputOf(node.type)) card.append(portButton(node, port));
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const origin = canvas.point(event.clientX, event.clientY);
      const { x, y } = node;
      button.setPointerCapture(event.pointerId);
      const move = (event) => {
        const point = canvas.point(event.clientX, event.clientY);
        if (!button.hasPointerCapture(event.pointerId)) return;
        node.x = bound(x + point.x - origin.x);
        node.y = bound(y + point.y - origin.y);
        position();
        draw();
      };
      button.addEventListener("pointermove", move);
      button.addEventListener("lostpointercapture", () => button.removeEventListener("pointermove", move), { once: true });
    });
    return card;
  }
  function showSelection() {
    const id = runDetail ? runNode : selected;
    for (const card of el("nodes").children) {
      card.firstElementChild.setAttribute("aria-pressed", String(card.dataset.node === id));
    }
  }
  function showRunStates() {
    const states = new Map((runDetail?.nodes ?? []).map(({ node, status }) => [node, status]));
    for (const card of el("nodes").children) {
      const status = states.get(card.dataset.node) ?? "";
      card.dataset.status = status;
      card.querySelector("small").textContent = [types[card.dataset.type], statusLabels[status] ?? status].filter(Boolean).join(" · ");
    }
    draw();
  }
  function outputPorts() {
    const type = documentState.nodes.find(({ id }) => id === el("from").value)?.type;
    choices(el("port"), outputOf(type).map((port) => [port, port]));
  }
  function render() {
    el("nodes").replaceChildren(...graph().nodes.map(nodeCard));
    const observing = Boolean(runDetail);
    el("edit-tools").hidden = observing;
    el("inspector-edit").hidden = observing;
    el("inspector-run").hidden = !observing;
    el("inspector-title").textContent = observing ? `실행 상세 · v${runDetail.run.version}` : "노드 설정";
    el("name").disabled = observing;
    el("plan").disabled = observing || !project;
    el("save").disabled = observing || !project;
    el("open-run").disabled = !workflow && !runDetail;
    showInspector();
    if (!observing) renderEdges();
    setConnection(null);
    showRunStates();
  }
  function renderEdges() {
    const nodes = documentState.nodes;
    const entries = nodes.map(({ id, label }) => [id, label]);
    choices(el("from"), entries.filter(([id]) => nodes.find((node) => node.id === id).type !== "end"));
    choices(el("to"), entries.filter(([id]) => nodes.find((node) => node.id === id).type !== "start"));
    outputPorts();
    el("edge-summary").textContent = `연결 (${documentState.edges.length})`;
    el("edges").replaceChildren(...documentState.edges.map((edge, index) => {
      const line = document.createElement("li"), remove = document.createElement("button");
      const name = (id) => nodes.find((node) => node.id === id)?.label ?? id;
      remove.type = "button";
      remove.textContent = "삭제";
      remove.setAttribute("aria-label", `${name(edge.from)} → ${name(edge.to)} 연결 삭제`);
      remove.onclick = () => { documentState.edges.splice(index, 1); renderEdges(); draw(); };
      line.append(name(edge.from) + " → " + name(edge.to) + " · " + portLabels[edge.port], remove);
      return line;
    }));
  }
  function showInspector() {
    const nodes = documentState.nodes;
    const item = nodes.find(({ id }) => selected === id);
    form.hidden = Boolean(runDetail) || !item;
    el("inspector-empty").hidden = Boolean(runDetail) || Boolean(item);
    if (runDetail) return;
    harness.show(item);
    if (item) {
      const { id, type, x, y, label, ...settings } = item;
      form.elements.label.value = label;
      if (type === "agent") {
        delete settings.definition;
        delete settings.version;
        delete settings.instruction;
      }
      form.elements.settings.value = JSON.stringify(settings, null, 2);
      el("delete").disabled = type === "start" || type === "end";
    }
  }
  function open(record) {
    workflow = record;
    documentState = record ? structuredClone(record.payload) : blank();
    selected = null;
    el("name").value = documentState.name;
    el("status").textContent = "";
    el("order").replaceChildren();
    el("plan-result").hidden = true;
    render();
    fit();
  }
  async function loadList(id) {
    const records = id ? await request("workflows", { project: id }) : [];
    if (id !== project) return;
    workflows = records;
    choices(selector, [["", "새 Workflow"], ...records.map(({ id, name }) => [id, name])]);
  }
  selector.addEventListener("change", report(async () => {
    const id = selector.value, owner = project;
    const current = id ? await request("workflow", { project: owner, id }) : null;
    if (owner === project && id === selector.value) {
      if (runDetail || el("run-list").value) await runs.refresh("");
      if (owner === project && id === selector.value) open(current);
    }
  }));
  el("from").addEventListener("change", outputPorts);
  el("add").addEventListener("click", () => {
    const type = el("type").value, id = crypto.randomUUID();
    const ref = definitions().find(({ kind }) => kind === (type === "agent" ? "harness" : "loop"));
    const config = {
      agent: { definition: ref?.id ?? "", instruction: "" }, loop: { definition: ref?.id ?? "", instruction: "" },
      command: { check: { command: "node", args: ["--test"], code: 0 } },
      condition: { source: "", field: "passed", equals: true }, approval: { prompt: "" },
      subgraph: { workflow: workflows.find((item) => item.id !== workflow?.id)?.id ?? "" },
    };
    const viewport = el("viewport").getBoundingClientRect();
    const center = canvas.point(viewport.left + viewport.width / 2, viewport.top + viewport.height / 2);
    const x = bound(center.x - nodeWidth / 2), centerY = bound(center.y - nodeHeight / 2);
    let y = centerY;
    while (y < 10000 && documentState.nodes.some((node) => Math.abs(node.x - x) < nodeWidth &&
      Math.abs(node.y - y) < nodeHeight)) y = bound(y + nodeHeight + 12);
    documentState.nodes.push({ id, type, label: types[type], x, y, ...config[type] });
    selected = id;
    render();
    const added = el("nodes").lastElementChild.getBoundingClientRect();
    if (added.bottom > viewport.bottom || added.top < viewport.top || added.right > viewport.right || added.left < viewport.left) fit();
  });
  el("connect").addEventListener("click", () => {
    connect({ from: el("from").value, to: el("to").value, port: el("port").value });
  });
  form.addEventListener("submit", report(async () => {
    const index = documentState.nodes.findIndex(({ id }) => selected === id);
    const { id, type, x, y } = documentState.nodes[index];
    const settings = JSON.parse(form.elements.settings.value);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("노드 설정은 JSON 객체여야 합니다.");
    documentState.nodes[index] = { ...harness.apply(settings), id, type, x, y, label: form.elements.label.value };
    render();
  }));
  el("delete").addEventListener("click", () => {
    documentState.nodes = documentState.nodes.filter(({ id }) => id !== selected);
    documentState.edges = documentState.edges.filter(({ from, to }) => from !== selected && to !== selected);
    selected = null; render();
  });
  for (const [action, endpoint] of [["save", "workflows"], ["plan", "workflows/plan"]]) {
    el(action).addEventListener("click", report(async () => {
      if (!project) throw new Error("프로젝트를 선택해 주세요.");
      const owner = project, payload = { ...documentState, name: el("name").value };
      const result = await request(endpoint, {}, { project: owner, payload, id: workflow?.id, version: workflow?.version });
      if (owner !== project) return;
      if (action === "save") {
        await loadList(owner);
        if (owner !== project) return;
        selector.value = result.id; open(result);
        el("status").textContent = "버전 " + result.version + " 저장됨";
      } else {
        const labels = new Map(result.document.nodes.map(({ id, label }) => [id, label]));
        el("plan-result").hidden = false;
        el("order").replaceChildren(...result.order.map((id) => {
          const item = document.createElement("li"); item.textContent = labels.get(id); return item;
        }));
      }
    }));
  }
  render();
  fit();
  return { showRun: runs.refresh, async selectProject(id) {
    if (id === project) return;
    project = id;
    selector.value = "";
    runDetail = null;
    runNode = null;
    open(null);
    await loadList(id);
    await runs.refresh();
  } };
}
