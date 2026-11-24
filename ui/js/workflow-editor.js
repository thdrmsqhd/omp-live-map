import { bindWorkflowRuns } from "./workflow-runs.js";
import { bindTemplateButtons } from "./workflow-templates.js";

const types = {
  start: "Start", end: "End", agent: "Agent", command: "Command", loop: "Loop",
  condition: "Condition", parallel: "Parallel", join: "Join", approval: "Approval", subgraph: "Subgraph",
};
const ports = { end: [], condition: ["true", "false"], approval: ["approved", "rejected"] };
const nodeWidth = 132, nodeHeight = 52;
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

export function bindWorkflow({ find, request, report, definitions }) {
  const el = (name) => find("workflow-" + name);
  const selector = el("list"), form = el("node-form");
  let project = "", workflow, selected, documentState = blank(), runDetail, workflows = [];
  const runs = bindWorkflowRuns({ el, request, report, current: () => workflow, projectId: () => project,
    onStatus(detail) { runDetail = detail; showRunStates(); } });
  bindTemplateButtons({ el, request, report, definitions, current: () => workflow, projectId: () => project, async imported(record) {
    await loadList(record.project); if (record.project === project) { selector.value = record.id; open(record); }
  } });
  choices(el("type"), Object.entries(types).filter(([type]) => !["start", "end"].includes(type)));
  function draw() {
    const nodes = documentState.nodes;
    const width = Math.max(650, ...nodes.map((node) => node.x + nodeWidth + 30));
    const height = Math.max(400, ...nodes.map((node) => node.y + nodeHeight + 30));
    const lines = el("lines");
    el("canvas").style.width = width + "px";
    el("canvas").style.height = height + "px";
    lines.setAttribute("width", width);
    lines.setAttribute("height", height);
    const positions = new Map(nodes.map((node) => [node.id, node]));
    const svg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
    lines.replaceChildren(...documentState.edges.map(({ from, to, port }) => {
      const start = positions.get(from), end = positions.get(to);
      const x1 = start.x + nodeWidth, y1 = start.y + nodeHeight / 2;
      const x2 = end.x, y2 = end.y + nodeHeight / 2, middle = (x1 + x2) / 2;
      const group = svg("g"), path = svg("path"), label = svg("text");
      path.setAttribute("d", `M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2} ${y2} M${x2 - 7} ${y2 - 4} L${x2} ${y2} L${x2 - 7} ${y2 + 4}`);
      label.setAttribute("x", middle + 3);
      label.setAttribute("y", (y1 + y2) / 2 - 5);
      label.textContent = port; group.append(path, label);
      return group;
    }));
  }
  function nodeButton(node) {
    const button = document.createElement("button");
    const label = document.createElement("strong"), type = document.createElement("small");
    button.className = "workflow-node";
    button.dataset.node = node.id;
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected === node.id));
    label.textContent = node.label; type.textContent = types[node.type]; button.append(label, type);
    const position = () => { button.style.left = node.x + "px"; button.style.top = node.y + "px"; };
    position();
    button.addEventListener("click", () => { selected = node.id; render(); });
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const x = node.x - event.clientX, y = node.y - event.clientY;
      button.setPointerCapture(event.pointerId);
      const move = (event) => {
        node.x = Math.min(10000, Math.max(0, Math.round(x + event.clientX)));
        node.y = Math.min(10000, Math.max(0, Math.round(y + event.clientY)));
        position(); draw();
      };
      button.addEventListener("pointermove", move);
      button.addEventListener("lostpointercapture", () => button.removeEventListener("pointermove", move), { once: true });
    });
    return button;
  }
  function showRunStates() {
    const sameVersion = runDetail?.run.workflow === workflow?.id && runDetail?.run.version === workflow?.version;
    const statusByNode = new Map((sameVersion ? runDetail?.nodes ?? [] : []).map(({ node, status }) => [node, status]));
    for (const button of el("nodes").children) {
      const node = documentState.nodes.find(({ id }) => id === button.dataset.node);
      const status = statusByNode.get(node.id) ?? "";
      button.dataset.status = status;
      button.querySelector("small").textContent = status ? types[node.type] + " · " + status : types[node.type];
    }
  }
  function outputPorts() {
    const type = documentState.nodes.find(({ id }) => id === el("from").value)?.type;
    choices(el("port"), (ports[type] ?? ["next"]).map((port) => [port, port]));
  }
  function render() {
    const nodes = documentState.nodes;
    const entries = nodes.map(({ id, label }) => [id, label]);
    el("nodes").replaceChildren(...nodes.map(nodeButton));
    showRunStates();
    choices(el("from"), entries.filter(([id]) => nodes.find((node) => node.id === id).type !== "end"));
    choices(el("to"), entries.filter(([id]) => nodes.find((node) => node.id === id).type !== "start"));
    outputPorts();
    el("edges").replaceChildren(...documentState.edges.map((edge, index) => {
      const line = document.createElement("li"), remove = document.createElement("button");
      const name = (id) => nodes.find((node) => node.id === id).label;
      remove.type = "button"; remove.textContent = "연결 삭제";
      remove.onclick = () => { documentState.edges.splice(index, 1); render(); };
      line.append(name(edge.from) + " → " + name(edge.to) + " (" + edge.port + ")", remove);
      return line;
    }));
    const item = nodes.find(({ id }) => selected === id);
    form.hidden = !item;
    if (item) {
      const { id, type, x, y, label, ...settings } = item;
      form.elements.label.value = label;
      form.elements.settings.value = JSON.stringify(settings, null, 2);
      el("delete").disabled = type === "start" || type === "end";
    }
    draw();
  }
  function open(record) {
    workflow = record;
    documentState = record?.payload ?? blank();
    selected = null;
    el("name").value = documentState.name;
    el("status").textContent = "";
    el("order").replaceChildren();
    render();
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
    if (owner === project && id === selector.value) open(current);
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
    const position = documentState.nodes.length;
    documentState.nodes.push({ id, type, label: types[type], x: 230, y: 70 + (position - 2) * 65, ...config[type] });
    selected = id; render();
  });
  el("connect").addEventListener("click", () => {
    const edge = { from: el("from").value, to: el("to").value, port: el("port").value };
    if (edge.from === edge.to || documentState.edges.some(({ from, to, port }) => from === edge.from && to === edge.to && port === edge.port)) return;
    documentState.edges.push(edge); render();
  });
  form.addEventListener("submit", report(async () => {
    const index = documentState.nodes.findIndex(({ id }) => selected === id);
    const { id, type, x, y } = documentState.nodes[index];
    const settings = JSON.parse(form.elements.settings.value);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("노드 설정은 JSON 객체여야 합니다.");
    documentState.nodes[index] = { ...settings, id, type, x, y, label: form.elements.label.value };
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
        el("order").replaceChildren(...result.order.map((id) => {
          const item = document.createElement("li"); item.textContent = labels.get(id); return item;
        }));
      }
    }));
  }
  return { showRun: runs.refresh, async selectProject(id) {
    if (id === project) return;
    project = id;
    selector.value = "";
    open(null);
    await loadList(id);
    await runs.refresh();
  } };
}
