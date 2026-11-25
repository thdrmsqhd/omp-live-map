/* Live Map에 별도 Workflow 레이어를 합성한다. 기존 세션 카드와 변환은 같은 좌표계를 쓴다. */
const wfMap = { run: null, selected: null, origin: null, positions: {}, buttons: new Map(), generation: 0, loading: false };
const wfSize = { w: 174, h: 76 };
const wfStatus = { queued: "대기", running: "실행 중", failed: "실패", interrupted: "확인 필요",
  waiting_approval: "승인 대기", succeeded: "완료", skipped: "건너뜀", paused: "일시 중지",
  cancelled: "취소", limit_exceeded: "실행 한도 초과" };
const wfPositionKey = (run) => run.workflow + ":" + run.version;
const wfLabel = (status) => wfStatus[status] ?? status ?? "대기";
const wfNodes = () => wfMap.run?.graph.nodes ?? [];
const wfEdges = () => wfMap.run?.graph.edges ?? [];
const wfPoint = (node) => wfMap.positions[node.id] ?? { x: wfMap.origin.x + node.x, y: wfMap.origin.y + node.y };
const workflowMapBoxes = () => wfNodes().map((node) => ({ ...wfPoint(node), ...wfSize }));

function wfText(tag, value) {
  const item = document.createElement(tag);
  item.textContent = value;
  return item;
}

function wfPersistPosition() {
  const key = wfPositionKey(wfMap.run.run);
  const cache = readJSON("omp-workflow-map-positions", {});
  delete cache[key];
  cache[key] = { origin: wfMap.origin, positions: wfMap.positions };
  for (const old of Object.keys(cache).slice(0, -20)) delete cache[old];
  writeJSON("omp-workflow-map-positions", cache);
}

function wfFit() {
  const box = boundsOf(workflowMapBoxes());
  if (!box) return;
  const stage = $("stage").getBoundingClientRect();
  const width = Math.max(160, stage.width - $("workflow-inspector").offsetWidth - 30);
  const k = Math.min(1.2, Math.max(0.12, Math.min((width - 24) / box.w, (stage.height - 90) / box.h)));
  animateView({ k, x: (width - box.w * k) / 2 - box.x * k, y: (stage.height - box.h * k) / 2 - box.y * k }, 170);
}

let wfEdgeSignature;
function wfPaintEdges() {
  const svg = $("workflow-map-edges");
  const points = new Map(wfNodes().map((node) => [node.id, wfPoint(node)]));
  const executions = new Map((wfMap.run?.nodes ?? []).map((node) => [node.node, node]));
  const signature = JSON.stringify([points.size ? [...points] : [], wfEdges(),
    [...executions].map(([id, { status, outcome }]) => [id, status, outcome?.port])]);
  if (signature === wfEdgeSignature) return;
  wfEdgeSignature = signature;
  const el = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
  svg.replaceChildren(...wfEdges().flatMap(({ from, to, port }) => {
    const start = points.get(from), end = points.get(to);
    if (!start || !end) return [];
    const x = start.x + wfSize.w, y = start.y + wfSize.h / 2;
    const tx = end.x, ty = end.y + wfSize.h / 2, bend = Math.max(36, Math.abs(tx - x) / 2);
    const group = el("g"), path = el("path"), label = el("text");
    path.setAttribute("d", `M${x},${y} C${x + bend},${y} ${tx - bend},${ty} ${tx},${ty} m-7,-4 l7,4 -7,4`);
    const before = executions.get(from), after = executions.get(to);
    if (before?.status === "succeeded" && after && after.status !== "skipped" && (before.outcome?.port ?? "next") === port) {
      group.setAttribute("data-active", "");
    }
    label.setAttribute("x", String((x + tx) / 2));
    label.setAttribute("y", String((y + ty) / 2 - 8));
    label.setAttribute("text-anchor", "middle");
    label.textContent = { next: "다음", true: "통과", false: "조건 불충족", approved: "승인", rejected: "반려" }[port] ?? port;
    group.append(path, label);
    return [group];
  }));
}

function wfCreateNode(node) {
  const button = wfText("button", "");
  button.type = "button";
  button.className = "wf-node";
  button.dataset.workflowNode = node.id;
  button.append(wfText("strong", node.label), wfText("small", ""));
  let drag, moved = false;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || spaceDown) return;
    event.stopPropagation();
    const p = worldPoint(event.clientX, event.clientY), position = wfPoint(node);
    drag = { x: p.x - position.x, y: p.y - position.y, clientX: event.clientX, clientY: event.clientY };
    moved = false;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (!drag || (!moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 3)) return;
    moved = true;
    const p = worldPoint(event.clientX, event.clientY);
    const position = { x: Math.round(p.x - drag.x), y: Math.round(p.y - drag.y) };
    wfMap.positions[node.id] = position;
    button.style.left = position.x + "px";
    button.style.top = position.y + "px";
    wfPaintEdges();
  });
  button.addEventListener("lostpointercapture", () => {
    if (moved && wfMap.run) { wfPersistPosition(); paintMinimap(); }
    drag = null;
  });
  button.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    wfMap.selected = node.id;
    paintWorkflowMap();
  });
  return button;
}

function wfClose() {
  wfMap.generation++;
  wfMap.run = null;
  wfEdgeSignature = undefined;
  wfMap.selected = null;
  wfMap.buttons.clear();
  $("workflow-map-nodes").replaceChildren();
  $("workflow-inspector").hidden = $("workflow-layer").hidden = true;
  writeJSON("omp-workflow-map-run", null);
  paintMinimap();
}

function wfAccept(detail, initial, node) {
  if (!detail.graph) throw new Error("선택한 실행에서 Workflow 그래프를 읽을 수 없습니다.");
  if (initial) {
    const sameVersion = wfMap.run && wfPositionKey(wfMap.run.run) === wfPositionKey(detail.run);
    if (!sameVersion) {
      const previous = readJSON("omp-workflow-map-positions", {})[wfPositionKey(detail.run)];
      const box = boundsOf([...geo.values(), ...CLUSTERS, ...SATS.values(), ...JOBS]);
      wfMap.origin = previous?.origin ?? { x: box ? box.x + box.w + 180 : 50, y: box?.y ?? 80 };
      wfMap.positions = previous?.positions ?? {};
    }
    wfMap.buttons.clear();
    $("workflow-map-nodes").replaceChildren();
    wfMap.selected = node ?? detail.nodes.find(({ status }) => ["failed", "waiting_approval", "running", "interrupted"].includes(status))?.node ??
      detail.graph.nodes[0]?.id;
  }
  wfMap.run = detail;
  paintWorkflowMap();
}

async function openMapWorkflow(id, node) {
  const token = ++wfMap.generation;
  $("workflow-inspector").hidden = false;
  $("wf-map-status").textContent = "실행을 불러오는 중입니다.";
  setMapMode("map");
  try {
    const detail = await mapWorkflowRequest("workflow-run", { id });
    if (token !== wfMap.generation) return;
    wfAccept(detail, true, node);
    writeJSON("omp-workflow-map-run", id);
    wfFit();
  } catch (error) {
    if (token === wfMap.generation) $("wf-map-status").textContent = error.message;
  }
}

async function refreshMapWorkflow() {
  if (!wfMap.run || wfMap.loading || mapMode !== "map") return;
  const id = wfMap.run.run.id, token = wfMap.generation;
  wfMap.loading = true;
  try {
    const detail = await mapWorkflowRequest("workflow-run", { id });
    if (token === wfMap.generation) wfAccept(detail, false);
  } catch (error) {
    if (token === wfMap.generation) $("wf-map-status").textContent = "갱신 실패 · " + error.message;
  } finally { wfMap.loading = false; }
}

$("wf-map-close").onclick = wfClose;
$("wf-map-fit").onclick = wfFit;
if (window.engineeringDesktop) {
  $("overview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-map-workflow]");
    if (button) void openMapWorkflow(button.dataset.mapWorkflow, button.dataset.mapWorkflowNode);
  });
  setInterval(refreshMapWorkflow, 1600);
  const last = readJSON("omp-workflow-map-run", null);
  if (last && mapMode === "map") queueMicrotask(() => void openMapWorkflow(last));
}
