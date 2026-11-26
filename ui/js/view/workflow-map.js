/* Live Map에 별도 Workflow 레이어를 합성한다. 기존 세션 카드와 변환은 같은 좌표계를 쓴다.
   노드·소켓·연결선은 Engineering 노드 캔버스(studio)와 같은 모양·색을 쓰고, 실행 중인 단계에는
   프롬프트 구성, 실시간 출력, 들어오는 선 위로 흐르는 점을 그려 "지금 여기서 프롬프트가 실행 중"임을 보여 준다. */
const wfMap = { run: null, selected: null, origin: null, positions: {}, buttons: new Map(), generation: 0, loading: false, defs: new Map(), defsFor: "" };
const wfSize = { w: 240, h: 150 };
const wfScale = { x: 2, y: 2.6 }; // 노드 캔버스와 같은 배율(저장 좌표 → 화면 좌표)
const WF_HEAD = 38, WF_IO_TOP = 6, WF_ROW = 22;
const wfStatus = { queued: "대기", running: "실행 중", failed: "실패", interrupted: "확인 필요",
  waiting_approval: "승인 대기", succeeded: "완료", skipped: "건너뜀", paused: "일시 중지",
  cancelled: "취소", limit_exceeded: "실행 한도 초과" };
const wfTypeNames = { start: "Start", end: "End", agent: "Agent", loop: "Loop 단계", command: "Command", condition: "Condition",
  parallel: "Parallel", join: "Join", approval: "Approval", subgraph: "Subgraph", profile: "에이전트 프로필" };
const wfPhases = { preparing: "준비 중", sources: "자료 읽는 중", prompting: "프롬프트 전달", responding: "응답 생성 중",
  thinking: "생각 중", writing: "파일 작성 중",
  tool: "도구 사용 중", verifying: "검증 명령 실행 중", command: "명령 실행 중" };
const wfPortNames = { next: "다음", true: "통과", false: "조건 불충족", approved: "승인", rejected: "반려", profile: "프로필" };
const wfPositionKey = (run) => run.workflow + ":" + run.version;
const wfLabel = (status) => wfStatus[status] ?? status ?? "대기";
const wfNodes = () => wfMap.edit?.payload.nodes ?? wfMap.run?.graph.nodes ?? [];
const wfEdges = () => wfMap.edit?.payload.edges ?? wfMap.run?.graph.edges ?? [];
const wfWidth = (node) => ["start", "end"].includes(node.type) ? 190 : wfSize.w;
const wfOutputs = (node) => node.type === "end" ? [] : node.type === "profile" ? ["profile"]
  : node.type === "condition" ? ["true", "false"] : node.type === "approval" ? ["approved", "rejected"] : ["next"];
const wfHasProfile = (node) => node.type === "agent" && wfEdges().some(({ to, port }) => to === node.id && port === "profile");
const wfInputs = (node) => ["start", "profile"].includes(node.type) ? [] : wfHasProfile(node) ? ["flow", "profile"] : ["flow"];
const wfSocketY = (index) => WF_HEAD + WF_IO_TOP + WF_ROW / 2 + index * WF_ROW;

function wfDefaultPositions(nodes) {
  const occupied = new Set(), defaults = new Map();
  let column = Math.max(0, ...nodes.map(({ x }) => x));
  for (const node of nodes) {
    const key = node.x + ":" + node.y;
    if (occupied.has(key)) {
      column += (wfSize.w + 60) / wfScale.x;
      defaults.set(node.id, { x: column, y: node.y });
    }
    occupied.add(key);
  }
  return defaults;
}
const wfPoint = (node) => {
  if (!wfMap.edit && wfMap.positions[node.id]) return wfMap.positions[node.id];
  const { x, y } = (wfMap.edit ? null : wfMap.defaults?.get(node.id)) ?? node;
  return { x: wfMap.origin.x + x * wfScale.x, y: wfMap.origin.y + y * wfScale.y };
};
const wfHeight = (node) => wfMap.buttons.get(node.id)?.offsetHeight || wfSize.h;
const workflowMapBoxes = () => mapMode === "map" ? wfNodes().map((node) => ({ ...wfPoint(node), w: wfWidth(node), h: wfHeight(node) })) : [];

function wfText(tag, value, className) {
  const item = document.createElement(tag);
  item.textContent = value;
  if (className) item.className = className;
  return item;
}

function wfPersistPosition() {
  const key = wfPositionKey(wfMap.run.run);
  const cache = readJSON("omp-workflow-map-positions-v2", {});
  delete cache[key];
  cache[key] = { origin: wfMap.origin, positions: wfMap.positions };
  for (const old of Object.keys(cache).slice(0, -20)) delete cache[old];
  writeJSON("omp-workflow-map-positions-v2", cache);
}

function wfFitView() {
  const box = boundsOf(workflowMapBoxes());
  if (!box) return null;
  const stage = $("stage").getBoundingClientRect();
  const width = Math.max(160, stage.width - $("workflow-inspector").offsetWidth - 30);
  const k = Math.min(1.2, Math.max(0.12, Math.min((width - 24) / box.w, (stage.height - 90) / box.h)));
  return { k, x: (width - box.w * k) / 2 - box.x * k, y: (stage.height - box.h * k) / 2 - box.y * k };
}
function wfFit() {
  const fitted = wfFitView();
  if (fitted) animateView(fitted, 170);
}

// ---- 실행 따라가기 --------------------------------------------------------------
// 실행 중(없으면 승인 대기)인 단계를 읽을 수 있는 배율로 화면 가운데(상세 패널 왼쪽)에 둔다.
// 켜 두면 다음 단계로 넘어갈 때 따라가고, 사용자가 화면을 움직이면(끌기·휠·확대 키) 멈춘다.
const WF_READABLE = 0.9;
// 그래프 전체를 보여 줘도 단계 이름·상태를 읽을 수 있는 배율(노드 캔버스의 자동 맞춤 하한과 비슷하게 둔다).
const WF_WHOLE_READABLE = 0.75;
function wfActiveNode(detail = wfMap.run) {
  if (!detail || wfMap.edit) return null;
  const order = new Map(detail.graph.nodes.map(({ id }, index) => [id, index]));
  const pick = (status) => detail.nodes.filter((item) => item.status === status && order.has(item.node))
    .sort((a, b) => order.get(a.node) - order.get(b.node))[0]?.node;
  return pick("running") ?? pick("waiting_approval") ?? null;
}
function wfFocusNode(id, dur = 260) {
  const node = wfNodes().find((item) => item.id === id);
  if (!node) return false;
  wfMap.followTarget = id;
  // 그래프 전체가 읽을 수 있는 배율(75% 이상)로 들어가면(단계가 적은 Workflow) 전체를 보여 주고 움직이지 않는다.
  const fitted = wfFitView();
  if (fitted && fitted.k >= WF_WHOLE_READABLE) {
    if (Math.abs(fitted.k - view.k) > .01 || Math.abs(fitted.x - view.x) > 2 || Math.abs(fitted.y - view.y) > 2) animateView(fitted, dur);
    return true;
  }
  const point = wfPoint(node), w = wfWidth(node), h = wfHeight(node);
  const stage = $("stage").getBoundingClientRect();
  const width = Math.max(160, stage.width - $("workflow-inspector").offsetWidth - 30);
  const k = Math.min(1.25, Math.max(WF_READABLE, view.k));
  animateView({ k, x: (width - w * k) / 2 - point.x * k, y: Math.max(24, (stage.height - h * k) / 2) - point.y * k }, dur);
  return true;
}
function wfPaintFollow() {
  const button = $("wf-map-follow");
  const active = wfActiveNode();
  button.hidden = !wfMap.run || Boolean(wfMap.edit);
  button.disabled = !active;
  button.setAttribute("aria-pressed", String(Boolean(wfMap.follow && active)));
  button.title = !active ? "실행 중이거나 승인을 기다리는 단계가 없습니다."
    : wfMap.follow ? "다음 단계로 넘어가면 화면이 따라갑니다. 화면을 움직이면 멈춥니다." : "누르면 실행 중인 단계로 이동하고 따라갑니다.";
}
function wfFollowActive(previous) {
  const active = wfActiveNode();
  if (!wfMap.follow || !active || mapMode !== "map") return;
  if (active === wfMap.followTarget && active === previous) return;
  // 따라가는 동안에는 상세 패널도 지금 단계를 보여 준다.
  if (wfMap.selected === previous || wfMap.selected === wfMap.followTarget) {
    wfMap.selected = active;
    paintWorkflowMap();
  }
  wfFocusNode(active, 420);
}
function wfStopFollow() {
  if (!wfMap.follow) return;
  wfMap.follow = false;
  wfPaintFollow();
}

// ---- 연결선 ------------------------------------------------------------------
function wfEdgeState(from, to, port, executions) {
  const before = executions.get(from), after = executions.get(to);
  if (port === "profile") return after?.status === "running" ? "profile-flowing" : "profile";
  const taken = before?.status === "succeeded" && (before.outcome?.port ?? "next") === port;
  if (taken && after?.status === "running") return "flowing";
  if (taken && after?.status === "waiting_approval") return "waiting";
  if (taken && after && after.status !== "skipped") return "done";
  if (before?.status === "skipped" || after?.status === "skipped") return "skipped";
  return "idle";
}

let wfEdgeSignature;
function wfPaintEdges() {
  const svg = $("workflow-map-edges");
  const nodes = new Map(wfNodes().map((node) => [node.id, node]));
  const executions = new Map((wfMap.edit ? [] : wfMap.run?.nodes ?? []).map((node) => [node.node, node]));
  const geometry = [...nodes.values()].map((node) => [node.id, wfPoint(node), wfWidth(node), wfInputs(node).join(), wfOutputs(node).join()]);
  const states = wfEdges().map(({ from, to, port }) => wfEdgeState(from, to, port, executions));
  const signature = JSON.stringify([geometry, wfEdges(), states]);
  if (signature === wfEdgeSignature) return;
  wfEdgeSignature = signature;
  const el = (tag, attributes = {}) => {
    const item = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value);
    return item;
  };
  svg.replaceChildren(...wfEdges().flatMap(({ from, to, port }, index) => {
    const source = nodes.get(from), target = nodes.get(to);
    if (!source || !target) return [];
    const start = wfPoint(source), end = wfPoint(target);
    const outIndex = Math.max(0, wfOutputs(source).indexOf(port));
    const inIndex = Math.max(0, wfInputs(target).indexOf(port === "profile" ? "profile" : "flow"));
    const x = start.x + wfWidth(source), y = start.y + wfSocketY(outIndex);
    const tx = end.x, ty = end.y + wfSocketY(inIndex), bend = Math.max(60, Math.abs(tx - x) * .45);
    const curve = `M${x},${y} C${x + bend},${y} ${tx - bend},${ty} ${tx},${ty}`;
    const state = states[index];
    const group = el("g", { "data-state": state, "data-port": port });
    if (port === "profile") group.setAttribute("data-profile", "");
    if (state === "done" || state === "flowing" || state === "waiting") group.setAttribute("data-active", "");
    group.append(el("path", { d: curve, class: "wf-wire" }));
    if (state === "flowing" || state === "profile-flowing") {
      // 프롬프트가 다음 단계로 흘러 들어가는 느낌: 선을 따라 움직이는 점 두 개
      for (const begin of ["0s", "-0.7s"]) {
        const packet = el("circle", { r: "5", class: "wf-packet" });
        packet.append(el("animateMotion", { dur: "1.4s", repeatCount: "indefinite", begin, path: curve }));
        group.append(packet);
      }
    }
    if (!["next", "profile"].includes(port)) {
      const label = el("text", { x: String((x + tx) / 2), y: String((y + ty) / 2 - 9), "text-anchor": "middle" });
      label.textContent = wfPortNames[port] ?? port;
      group.append(label);
    }
    return [group];
  }));
}

// ---- 노드 카드 ---------------------------------------------------------------
function wfCreateNode(node) {
  const button = wfText("button", "");
  button.type = "button";
  button.className = "wf-node";
  button.dataset.workflowNode = node.id;
  button.dataset.type = node.type;
  const head = wfText("span", "", "wf-head");
  head.append(wfText("span", "", "wf-dot"), wfText("strong", node.label, "wf-title"), wfText("small", "", "wf-badge"));
  const live = wfText("span", "", "wf-live");
  live.append(wfText("span", "", "wf-phase"), wfText("span", "", "wf-bar"), wfText("span", "", "wf-stream"), wfText("span", "", "wf-tools"));
  button.append(head, wfText("span", "", "wf-io"), wfText("span", "", "wf-chain"), wfText("span", "", "wf-prompt"), live, wfText("span", "", "wf-result"));
  const parts = Object.fromEntries(["wf-title", "wf-badge", "wf-io", "wf-chain", "wf-prompt", "wf-live", "wf-phase", "wf-bar", "wf-stream", "wf-tools", "wf-result"]
    .map((name) => [name, button.querySelector("." + name)]));
  button.wfParts = parts;
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
    if (wfMap.edit) {
      node.x = Math.min(10000, Math.max(0, Math.round((position.x - wfMap.origin.x) / wfScale.x)));
      node.y = Math.min(10000, Math.max(0, Math.round((position.y - wfMap.origin.y) / wfScale.y)));
    } else wfMap.positions[node.id] = position;
    button.style.left = wfPoint(node).x + "px";
    button.style.top = wfPoint(node).y + "px";
    wfPlaceNodeActions(node.id);
    wfPaintEdges();
  });
  button.addEventListener("lostpointercapture", () => {
    if (moved && wfMap.run) { if (!wfMap.edit) wfPersistPosition(); paintMinimap(); }
    drag = null;
  });
  button.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    if (wfMap.edit && !wfSelectEditNode(node.id)) return;
    wfMap.selected = node.id;
    if (!wfMap.edit) writeJSON("omp-workflow-map-selection", { id: wfMap.run.run.id, node: node.id });
    paintWorkflowMap();
  });
  return button;
}

// ---- 노드 카드 바로 아래의 개입 도구 ------------------------------------------------
// 승인 대기 단계는 승인·반려를, 실패한 단계는 재실행을 캔버스에서 바로 한다(상세 패널을 찾아가지 않아도 된다).
// 노드 카드는 <button> 이라 안에 입력칸을 넣을 수 없으므로 같은 레이어에 따로 두고 카드 아래에 붙인다.
const wfActionBars = new Map();
function wfPlaceNodeActions(id) {
  const bar = wfActionBars.get(id), button = wfMap.buttons.get(id), node = wfNodes().find((item) => item.id === id);
  if (!bar || !button || !node) return;
  const point = wfPoint(node);
  bar.style.left = point.x + "px";
  bar.style.top = point.y + button.offsetHeight + 6 + "px";
  bar.style.width = wfWidth(node) + "px";
}
function wfPaintNodeActions(executions) {
  const want = new Map();
  if (!wfMap.edit && wfMap.run) {
    for (const node of wfNodes()) {
      const execution = executions.get(node.id);
      if (wfMap.run.run.status === "waiting_approval" && execution?.status === "waiting_approval") want.set(node.id, "approval");
      else if (wfMap.run.interventions?.[node.id]) want.set(node.id, "retry");
    }
  }
  for (const [id, bar] of wfActionBars) if (want.get(id) !== bar.dataset.kind) { bar.remove(); wfActionBars.delete(id); }
  for (const [id, kind] of want) {
    if (!wfActionBars.has(id)) {
      const bar = wfText("div", "", "wf-node-actions");
      bar.dataset.kind = kind;
      bar.dataset.workflowControls = "";
      bar.dataset.actionsFor = id;
      const status = wfText("small", "", "wf-node-actions-status");
      status.setAttribute("role", "status");
      if (kind === "approval") {
        const memo = document.createElement("textarea");
        memo.rows = 2;
        memo.maxLength = 2000;
        memo.placeholder = "승인 메모(선택) · 반려 사유(필수)";
        memo.setAttribute("aria-label", "승인 메모 또는 반려 사유");
        const row = wfText("div", "", "wf-node-actions-row");
        for (const [decision, label] of [["approved", "승인"], ["rejected", "반려"]]) {
          const action = wfActionButton(label, ({ currentTarget }) => {
            if (decision === "rejected" && !memo.value.trim()) { status.textContent = "반려 사유를 입력해 주세요."; memo.focus(); return; }
            status.textContent = "";
            return wfPerform(currentTarget, "workflow-runs/approval", { node: id, decision, reason: memo.value });
          });
          action.dataset.decision = decision;
          row.append(action);
        }
        memo.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); row.querySelector('[data-decision="approved"]').click(); }
        });
        bar.append(memo, row, status);
      } else {
        const options = wfMap.run.interventions[id];
        const row = wfText("div", "", "wf-node-actions-row");
        row.append(wfActionButton(options.verify ? "검증만 재실행" : "이 단계 재실행", ({ currentTarget }) =>
          wfPerform(currentTarget, "workflow-runs/retry", { node: id, mode: options.verify ? "verify" : "retry" })));
        if (options.rework?.length) row.append(wfActionButton("수정 요청…", () => {
          wfMap.selected = id;
          paintWorkflowMap();
          $("wf-map-details").querySelector("details")?.setAttribute("open", "");
        }));
        bar.append(row, status);
      }
      for (const type of ["pointerdown", "wheel", "dblclick"]) bar.addEventListener(type, (event) => event.stopPropagation());
      $("workflow-map-nodes").append(bar);
      wfActionBars.set(id, bar);
    }
    wfPlaceNodeActions(id);
  }
}

function wfChip(type, text, title) {
  const chip = wfText("span", "", "wf-chip");
  chip.dataset.type = type;
  chip.append(wfText("i", ""), wfText("span", text));
  if (title) chip.title = title;
  return chip;
}

function wfDefinition(id) { return id ? wfMap.defs.get(id) : null; }

// 단계에 붙은 정의 사슬: 프로필 또는 하네스 → 모델, 루프 → 하네스 → 모델. 실행이 끝났으면 실제로 쓴 정의를 우선한다.
function wfChainOf(node, execution) {
  const chips = [];
  const used = execution?.outcome?.definitions;
  if (node.type === "agent" && wfHasProfile(node)) {
    const edge = wfEdges().find(({ to, port }) => to === node.id && port === "profile");
    const profile = wfNodes().find(({ id }) => id === edge.from);
    chips.push(wfChip("profile", (profile?.label ?? "프로필") + (profile?.profileVersion ? " v" + profile.profileVersion : ""), "에이전트 프로필"));
    if (used?.model) chips.push(wfChip("model", used.model.name, "모델"));
    return chips;
  }
  if (node.type === "agent" || node.type === "loop") {
    const target = wfDefinition(node.definition);
    let harness = node.type === "agent" ? target : wfDefinition(target?.payload?.harness);
    if (node.type === "loop") {
      chips.push(wfChip("loop", (target?.name ?? "루프") + (node.version ? " v" + node.version : "") +
        (target?.payload?.attempts ? " · 최대 " + target.payload.attempts + "회" : ""), "루프"));
    }
    const harnessName = used?.harness ? used.harness.name + " v" + used.harness.version
      : harness ? harness.name + (node.type === "agent" && node.version ? " v" + node.version : "") : node.type === "agent" ? "하네스" : "";
    if (harnessName) chips.push(wfChip("harness", harnessName, "하네스"));
    const model = used?.model?.name ?? wfDefinition(harness?.payload?.model)?.name;
    if (model) chips.push(wfChip("model", model, "모델"));
  }
  if (node.type === "command" && node.check) chips.push(wfChip("flow", "$ " + [node.check.command, ...(node.check.args ?? [])].join(" "), "검증 명령"));
  return chips;
}

const wfClock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
};
const wfCost = (cents) => Number.isFinite(cents) ? "$" + (cents / 100).toFixed(2) : "";
const wfTail = (text, lines = 4, width = 120) => String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
  .slice(-lines).map((line) => line.length > width ? "…" + line.slice(-width) : line).join("\n");

// 프롬프트 구성 막대: 하네스 역할·지시, 규칙·스킬, 저장소 자료, 결과 형식, 작업 지시, 이전 검증 피드백
const wfSectionNames = { role: "역할", instructions: "하네스 지시", assets: "규칙·스킬", source: "자료", result: "결과 형식", task: "작업 지시", feedback: "검증 피드백" };
function wfPaintBar(bar, sections) {
  const total = sections.reduce((sum, { chars }) => sum + chars, 0);
  bar.replaceChildren(...(total ? sections : []).map(({ name, chars }) => {
    const part = wfText("i", "");
    part.dataset.section = name;
    part.style.flexGrow = String(Math.max(chars, total * .02));
    part.title = (wfSectionNames[name] ?? name) + " · " + chars.toLocaleString() + "자";
    return part;
  }));
  bar.hidden = !total;
}

function wfResultOf(node, execution) {
  const outcome = execution?.outcome;
  if (!outcome || !execution) return "";
  if (execution.status === "waiting_approval") return "사람의 결정을 기다립니다";
  if (outcome.error) return outcome.error.split("\n")[0].slice(0, 140);
  const parts = [];
  if (outcome.attempts?.length) parts.push("시도 " + outcome.attempts.length);
  if (outcome.checks?.length) parts.push("검증 " + outcome.checks.filter(({ passed }) => passed).length + "/" + outcome.checks.length + " 통과");
  const tools = [...new Set((outcome.attempts ?? []).flatMap(({ tools }) => tools ?? []))];
  if (tools.length) parts.push("도구 " + tools.slice(0, 4).join(", "));
  // 격리 런타임은 호출 전에 잡은 예약액(reserved)을 남긴다. 청구 금액으로 읽히지 않게 구분한다(구독 로그인은 청구 없음).
  const reserved = (outcome.attempts ?? []).some(({ costBasis }) => costBasis === "reserved");
  if (outcome.costCents) parts.push((reserved ? "호출 예약 " : "") + wfCost(outcome.costCents));
  if (outcome.port && outcome.port !== "next") parts.push(wfPortNames[outcome.port] ?? outcome.port);
  if (outcome.reason) parts.push(outcome.reason.slice(0, 60));
  return parts.join(" · ");
}

function wfPaintNode(button, node, execution, live) {
  const parts = button.wfParts;
  const status = node.type === "profile" ? "profile" : execution?.status ?? "queued";
  button.dataset.status = status;
  button.style.width = wfWidth(node) + "px";
  parts["wf-title"].textContent = node.label;
  parts["wf-badge"].textContent = node.type === "profile" ? "에이전트 프로필 · v" + node.profileVersion
    : wfMap.edit ? wfEditTypes[node.type] ?? node.type : (wfTypeNames[node.type] ?? node.type) + " · " + wfLabel(execution?.status);
  // 소켓(입력 왼쪽, 출력 오른쪽). 연결선 끝점과 같은 줄에 그린다.
  const ins = wfInputs(node), outs = wfOutputs(node);
  const io = parts["wf-io"];
  const ioKey = ins.join() + "|" + outs.join();
  if (io.dataset.key !== ioKey) {
    io.dataset.key = ioKey;
    const rows = Math.max(ins.length, outs.length);
    io.replaceChildren(...Array.from({ length: rows }, (_, index) => {
      const row = wfText("span", "", "wf-io-row");
      const input = ins[index], output = outs[index];
      const left = wfText("span", input ? (input === "profile" ? "프로필" : "입력") : "", "wf-in");
      if (input) left.dataset.type = input;
      const right = wfText("span", output ? wfPortNames[output] : "", "wf-out");
      if (output) { right.dataset.type = output === "profile" ? "profile" : "flow"; right.dataset.port = output; }
      row.append(left, right);
      return row;
    }));
    io.hidden = !rows;
  }
  const chain = wfChainOf(node, execution);
  parts["wf-chain"].replaceChildren(...chain);
  parts["wf-chain"].hidden = !chain.length;
  const preview = node.type === "approval" ? node.prompt : node.instruction;
  parts["wf-prompt"].textContent = preview ? wfTail(preview, 3, 90) : "";
  parts["wf-prompt"].hidden = !preview || status === "running";
  const running = status === "running" && !wfMap.edit;
  parts["wf-live"].hidden = !running;
  if (running) {
    const started = live?.startedAt ?? execution?.updated ?? Date.now();
    parts["wf-phase"].dataset.started = String(started);
    parts["wf-phase"].dataset.label = [wfPhases[live?.phase] ?? "실행 중", live?.attempts > 1 ? "시도 " + Math.max(1, live.attempt) + "/" + live.attempts : ""]
      .filter(Boolean).join(" · ");
    parts["wf-phase"].textContent = parts["wf-phase"].dataset.label + " · " + wfClock(Date.now() - started);
    wfPaintBar(parts["wf-bar"], live?.sections ?? []);
    // 최신 출력이 아래에 붙고 위로 밀려 올라가게 한다(넘치는 윗줄은 가려진다).
    const stream = wfTail(live?.text, 6) || (preview ? "▸ " + wfTail(preview, 2, 90) : "");
    const line = wfText("span", stream, "wf-stream-text");
    line.append(wfText("span", "", "wf-caret"));
    parts["wf-stream"].replaceChildren(line);
    parts["wf-tools"].replaceChildren(...(live?.tools ?? []).map((tool) => wfText("span", tool, tool === live.tool ? "is-current" : "")));
    parts["wf-tools"].hidden = !live?.tools?.length;
  } else delete parts["wf-phase"].dataset.started;
  const result = wfMap.edit ? "" : wfResultOf(node, execution);
  parts["wf-result"].textContent = result;
  parts["wf-result"].hidden = !result || running;
}

// 실행 중 단계의 경과 시간을 1초마다 갱신한다(서버 응답을 기다리지 않음).
function wfTickClocks() {
  for (const phase of document.querySelectorAll("#workflow-map-nodes .wf-phase[data-started], #wf-map-live .wf-phase[data-started]")) {
    phase.textContent = phase.dataset.label + " · " + wfClock(Date.now() - Number(phase.dataset.started));
  }
}

function wfClose() {
  if (wfMap.edit && !wfLeaveEditing()) return;
  wfMap.generation++;
  wfMap.opening = false;
  wfMap.run = null;
  wfMap.follow = false;
  wfMap.followTarget = null;
  wfEdgeSignature = undefined;
  wfMap.selected = null;
  wfMap.buttons.clear();
  wfActionBars.clear();
  $("workflow-map-nodes").replaceChildren();
  $("workflow-inspector").hidden = $("workflow-layer").hidden = true;
  writeJSON("omp-workflow-map-run", null);
  if (wfMap.previousView && mapMode === "map") animateView(wfMap.previousView);
  else paintMinimap();
  wfMap.previousView = null;
}

// 단계가 쓰는 하네스·루프·모델 이름을 보여 주려고 프로젝트 정의를 한 번 읽는다(실패해도 실행 표시는 계속한다).
async function wfLoadDefinitions(project) {
  if (!project || wfMap.defsFor === project) return;
  wfMap.defsFor = project;
  try {
    const records = await mapWorkflowRequest("definitions", { project });
    wfMap.defs = new Map(records.map((record) => [record.id, record]));
    if (wfMap.run?.run.project === project) paintWorkflowMap();
  } catch { wfMap.defsFor = ""; }
}

function wfAccept(detail, initial, node) {
  if (!detail.graph) throw new Error("선택한 실행에서 Workflow 그래프를 읽을 수 없습니다.");
  if (initial) {
    wfMap.defaults = wfDefaultPositions(detail.graph.nodes);
    const sameVersion = wfMap.run && wfPositionKey(wfMap.run.run) === wfPositionKey(detail.run);
    if (!sameVersion) {
      const previous = readJSON("omp-workflow-map-positions-v2", {})[wfPositionKey(detail.run)];
      const box = boundsOf([...geo.values(), ...CLUSTERS, ...SATS.values(), ...JOBS]);
      wfMap.origin = previous?.origin ?? { x: box ? box.x + box.w + 180 : 50, y: box?.y ?? 80 };
      wfMap.positions = previous?.positions ?? {};
    }
    wfMap.buttons.clear();
  wfActionBars.clear();
    $("workflow-map-nodes").replaceChildren();
    const target = detail.graph.nodes.find(({ id }) => id === node)?.id;
    wfMap.selected = target ?? detail.nodes.find(({ status }) => ["failed", "waiting_approval", "running", "interrupted"].includes(status))?.node ??
      detail.graph.nodes[0]?.id;
  }
  const previous = wfActiveNode();
  wfMap.run = detail;
  void wfLoadDefinitions(detail.run.project);
  paintWorkflowMap();
  if (!initial) wfFollowActive(previous);
  wfPaintFollow();
}

async function openMapWorkflow(id, node) {
  if (wfMap.edit && !wfLeaveEditing()) return false;
  const token = ++wfMap.generation;
  wfMap.opening = true;
  wfMap.notice = "";
  $("workflow-inspector").hidden = false;
  $("wf-map-status").textContent = "실행을 불러오는 중입니다.";
  setMapMode("map");
  try {
    const detail = await mapWorkflowRequest("workflow-run", { id });
    if (token !== wfMap.generation) return false;
    wfMap.previousView ??= { ...view };
    wfMap.follow = false;
    wfMap.followTarget = null;
    wfAccept(detail, true, node);
    writeJSON("omp-workflow-map-run", id);
    // 실행 중이거나 승인을 기다리는 단계가 있으면 그 단계를 읽을 수 있게 보여 주고 따라가기를 켠다.
    const active = wfActiveNode();
    if (active && !node) {
      wfMap.follow = true;
      wfMap.selected = active;
      paintWorkflowMap();
      // 방금 만든 노드의 높이를 재려면 한 프레임 뒤에 맞춘다.
      requestAnimationFrame(() => { if (token === wfMap.generation) wfFocusNode(active, 200); });
    } else if (active && node) wfFocusNode(node, 200);
    else wfFit();
    wfPaintFollow();
    return true;
  } catch (error) {
    if (token === wfMap.generation) $("wf-map-status").textContent = error.message;
    return false;
  } finally {
    if (token === wfMap.generation) wfMap.opening = false;
  }
}

async function refreshMapWorkflow() {
  if (!wfMap.run || wfMap.edit || wfMap.opening || wfMap.loading || wfMap.intervening || mapMode !== "map") return;
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
$("wf-map-fit").onclick = () => { wfStopFollow(); wfFit(); };
$("wf-map-follow").onclick = () => {
  wfMap.follow = !wfMap.follow;
  const active = wfActiveNode();
  if (wfMap.follow && active) {
    wfMap.selected = active;
    paintWorkflowMap();
    wfFocusNode(active);
  }
  wfPaintFollow();
};
// 사용자가 화면을 움직이면 자동 이동을 멈춘다. 노드를 누르기만 한 것은 움직임으로 치지 않는다.
{
  const stage = $("stage");
  let press = null;
  const outside = (event) => !event.target.closest?.("[data-workflow-controls], dialog");
  stage.addEventListener("wheel", (event) => { if (wfMap.follow && mapMode === "map" && outside(event)) wfStopFollow(); }, { passive: true, capture: true });
  stage.addEventListener("pointerdown", (event) => { press = wfMap.follow && outside(event) ? { x: view.x, y: view.y, k: view.k } : null; }, true);
  addEventListener("pointerup", () => {
    if (press && (Math.abs(view.x - press.x) > 2 || Math.abs(view.y - press.y) > 2 || view.k !== press.k)) wfStopFollow();
    press = null;
  }, true);
  addEventListener("keydown", (event) => {
    if (!wfMap.follow || mapMode !== "map" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/input|textarea|select/i.test(event.target?.tagName ?? "") || event.target?.isContentEditable) return;
    if (["+", "=", "-", "_", "0", "1"].includes(event.key)) wfStopFollow();
  }, true);
}
$("wf-map-new").onclick = () => {
  if (wfMap.run && !wfMap.opening && (!wfMap.edit || wfLeaveEditing())) void openMapWorkflowLaunch(wfMap.run.run.project, wfMap.run.run.workflow);
};
setInterval(wfTickClocks, 1000);
if (window.engineeringDesktop) {
  $("overview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-map-workflow]");
    if (button) void openMapWorkflow(button.dataset.mapWorkflow, button.dataset.mapWorkflowNode);
  });
  // 실행 중에는 0.8초마다, 그 밖에는 1.6초마다 상태를 받아 실시간 출력이 끊기지 않게 한다.
  let wfPollTick = 0;
  setInterval(() => {
    wfPollTick++;
    if (["running", "queued"].includes(wfMap.run?.run.status) || wfPollTick % 2 === 0) void refreshMapWorkflow();
  }, 800);
  // 다른 화면에서 넘어온 주소: ?run=<실행>(그 실행을 연다), ?launch=<Workflow>&project=<프로젝트>(새 실행 대화상자).
  const address = new URLSearchParams(location.search);
  if (address.get("run")) writeJSON("omp-workflow-map-run", address.get("run"));
  if (address.has("run") || address.has("launch")) {
    if (mapMode !== "map") setMapMode("map", false);
    history.replaceState(null, "", location.pathname);
  }
  if (address.get("launch")) document.addEventListener("DOMContentLoaded", () => {
    void openMapWorkflowLaunch(address.get("project") || undefined, address.get("launch"));
  }, { once: true });
  const last = readJSON("omp-workflow-map-run", null);
  // 마지막으로 본 실행을 다시 연다. 주소로 설계 모드를 열었으면(design-mode.js 가 먼저 바꾼다) 모드를 빼앗지 않는다.
  if (last && mapMode === "map") document.addEventListener("DOMContentLoaded", () => {
    if (mapMode !== "map") return;
    const selected = readJSON("omp-workflow-map-selection", null);
    void openMapWorkflow(last, selected?.id === last ? selected.node : undefined);
  }, { once: true });
}

// '설계에서 편집': 같은 화면의 설계 모드에서 이 실행의 Workflow 를 연다(데스크톱 앱).
$("wf-map-engineering").addEventListener("click", (event) => {
  if (!window.ompDesign || !wfMap.run) return;
  event.preventDefault();
  void window.ompDesign.open({ project: wfMap.run.run.project, workflow: wfMap.run.run.workflow });
});
