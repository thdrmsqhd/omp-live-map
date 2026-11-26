// 노드 캔버스: 모델 → 하네스 → 루프 → Workflow 단계, 에이전트 프로필 → Agent 를 한 캔버스에서 연결해 엔지니어링한다.
// 저장 형식은 기존 화면과 같다(정의 API·프로필 API·Workflow API). 이 화면만의 상태는 노드 위치(localStorage)뿐이다.
import { bindStudioCanvas } from "./studio-canvas.js";
import { bindStudioInspect } from "./studio-inspect.js";
import { loadModelOptions } from "./engineering-model-options.js";
import {
  h, KIND_LABELS, STEP_TYPES, STEP_HINTS, SCOPE_LABELS, HARNESS_TEMPLATES, HARNESS_CATALOG,
  socketsOf, widgetsOf, problemsOf, blankPayload, blankStep, harnessTypeOf,
  harnessContractDetails, isEvaluationHarness, isEvaluationRole, evaluationFlowBlock, socketDragAllowed,
  EXTERNAL_LANE_X, EXTERNAL_LANE_LABEL,
} from "./studio-nodes.js";

const COLUMN = { model: 0, harness: 400, loop: 800, profile: 800 };
const KIND_ORDER = { model: 0, harness: 1, loop: 2, profile: 3 };
const WORKFLOW_X = 1220, SX = 2, SY = 2.6, GAP = 28;
// 단계에 연결되지 않은 프로필은 여러 열 격자로 둔다. 정의만 볼 때는 비어 있는 Workflow 구역(오른쪽)에,
// Workflow 를 열었을 때는 단계와 겹치지 않게 라이브러리 아래에 놓는다.
const GRID_LIBRARY = [WORKFLOW_X - 20, WORKFLOW_X + 320], GRID_WORKFLOW = [0, 400, 800];
// 자동 맞춤의 최소 배율. 글자를 읽을 수 있어야 한다. '전체 보기' 버튼만 이보다 작게 줄인다.
const READABLE = { workflow: .7, library: .6 };
// v2: 프로필 격자와 기본 접힘을 도입하면서 한 열로 쌓인 이전 위치를 한 번 버린다.
const LAYOUT_KEY = "omp-studio-layout-v2";
const TYPE_LABELS = { model: "모델", harness: "하네스", loop: "루프", profile: "프로필", flow: "실행 순서" };
const PORT_NAMES = { next: "다음", true: "참", false: "거짓", approved: "승인", rejected: "거절" };
const clamp = (value) => Math.min(10000, Math.max(0, Math.round(value)));
const blankDocument = () => ({ name: "", nodes: [
  { id: "start", type: "start", label: "Start", x: 0, y: 40 },
  { id: "end", type: "end", label: "End", x: 420, y: 40 },
], edges: [] });

function readLayout() {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function bindStudio({ find, request, report, currentProject, changed: notifyChanged, openWorkflow, profilesChanged }) {
  const el = (id) => find("studio-" + id);
  const viewport = el("viewport"), surface = el("surface"), layer = el("nodes"), lines = el("lines");
  const statusLine = el("status"), menu = el("menu"), menuList = el("menu-list"), menuSearch = el("menu-search");
  const workflowPicker = el("workflow"), workflowName = el("workflow-name");
  const nodes = new Map();
  const pinned = new Set();
  let layout = readLayout();
  let defs = [], profiles = [], workflows = [], catalog = { engineering: [], claude: [], omp: [] };
  let project = null, wf = null, mode = "linked";
  let selected = "", selectedEdge = "", link = null, drawQueued = false, active = false, loadedFor = null, busy = false;

  const say = (message, tone = "") => { statusLine.textContent = message ?? ""; statusLine.dataset.tone = tone; };
  const desktop = () => Boolean(window.engineeringDesktop);
  // 이 화면의 오류는 캔버스 바로 위 상태 줄에 보여 준다. 서버의 영문 검사 오류는 한국어로 풀고 문제 단계를 고른다.
  const guard = (work) => async (...args) => {
    try { return await work(...args); } catch (error) { explain(error.message); }
  };
  function explain(message) {
    const step = (id) => stepById(id) ?? steps().find(({ data }) => data.label === id);
    const label = (id) => step(id) ? "‘" + step(id).data.label + "’" : "‘" + id + "’";
    const rules = [
      [/^A graph cannot contain cycles or unreachable nodes$/, () => "연결되지 않은 단계가 있거나 순환이 있습니다. 모든 단계가 Start에서 이어지도록 연결하세요."],
      [/^Missing or duplicate output (.+)\.(\w+)$/, (id, port) => `${label(id)} 단계의 ‘${PORT_NAMES[port] ?? port}’ 출력을 다음 단계 하나에 연결하세요.`],
      [/^Invalid incoming connections for (.+)$/, (id) => `${label(id)} 단계의 입력 연결이 없거나 너무 많습니다.`],
      [/^Select a harness or connect a profile to (.+)$/, (id) => `${label(id)} 단계에 하네스나 프로필을 연결하세요.`],
      [/^Invalid node instruction$/, () => "Agent·Loop 단계의 작업 지시를 입력하세요."],
      [/^Invalid approval prompt$/, () => "Approval 단계의 승인 안내를 입력하세요."],
      [/^Invalid node definition$/, () => "Loop 단계에 루프를 연결하세요."],
      [/^Invalid subgraph definition$/, () => "Subgraph 단계에서 호출할 Workflow를 고르세요."],
      [/^Invalid condition source$/, () => "Condition 단계의 기준 단계를 고르세요."],
      [/^A graph needs exactly one Start and one End$/, () => "Start와 End가 각각 하나씩 있어야 합니다."],
      [/^Parallel requires two or more distinct branches$/, () => "Parallel 단계는 서로 다른 두 갈래 이상으로 연결하세요."],
      [/^Join requires distinct predecessors$/, () => "Join 단계에는 서로 다른 두 단계 이상을 연결하세요."],
      [/^Condition source must be a compatible predecessor$/, () => "Condition의 기준 단계는 앞에 있는 단계여야 합니다(검증 통과 조건은 Command·Loop 단계만)."],
      [/^Input must reference a predecessor artifact$/, () => "산출물 입력은 앞 단계가 내는 산출물만 참조할 수 있습니다."],
      [/^Invalid handoff schema ID$/, () => "인계 스키마 ID는 소문자로 시작하는 최대 48자의 소문자·숫자·밑줄이어야 합니다."],
      [/^Handoff (.+) → (.+) \((.+)\): both endpoints/, (from, to, schema) => `${label(from)} → ${label(to)} (${schema}): 양쪽 단계 모두 이 프로젝트에서 쓸 수 있는 저장된 Agent·Loop 하네스를 선택하세요. 세션 프로필은 지원하지 않습니다.`],
      [/^Handoff (.+) → (.+) \((.+)\): source must/, (from, to, schema) => `${label(from)} → ${label(to)} (${schema}): 송신 단계의 산출물 경로를 저장된 하네스의 결과 파일 경로와 일치시키세요.`],
      [/^Handoff (.+) → (.+) \((.+)\): target must/, (from, to, schema) => `${label(from)} → ${label(to)} (${schema}): 수신 하네스가 선언한 입력 이름에 이 산출물을 연결하세요.`],
      [/^Workflow name is already in use$/, () => "같은 이름의 Workflow가 이미 있습니다."],
      [/^Definition name is already in use$/, () => "같은 저장 범위에 같은 이름의 정의가 이미 있습니다. 이름을 바꾸세요."],
      [/^(Definition|Workflow) changed\. Reload it before saving\.$/, () => "다른 화면에서 먼저 저장했습니다. Workflow를 다시 열어 최신 버전을 불러온 뒤 고치세요."],
      [/^Definition reference has an incompatible scope or kind$/, () => "연결한 정의의 저장 범위나 종류가 맞지 않습니다."],
      [/^Project is archived$/, () => "보관된 프로젝트에는 저장할 수 없습니다."],
    ];
    for (const [pattern, text] of rules) {
      const match = message.match(pattern);
      if (!match) continue;
      say(text(...match.slice(1)), "error");
      const culprit = match[1] && step(match[1]);
      if (culprit) focusNode(culprit);
      return;
    }
    say(message, "error");
  }
  function focusNode(node) {
    select(node.key);
    if (node.el) canvas.reveal({ x: node.x, y: node.y, width: node.el.offsetWidth, height: node.el.offsetHeight });
  }
  let catalogRequest = null;
  const canvas = bindStudioCanvas({ viewport, surface, scaleOutput: el("scale"), onBackground: () => select(""), onChange: () => closeMenu() });
  const resize = new ResizeObserver(() => scheduleDraw());
  // 정의 노드 상세(버전 기록·실제 적용값·사용 중 Workflow·비교 실행). 폼 화면 대신 노드 메뉴에서 연다.
  const inspect = bindStudioInspect({ root: el("inspect"), h, request, project: () => project?.id ?? "", say,
    payloadOf: (node) => payloadOf(node),
    loadVersion(node, payload) {
      node.draft = payload;
      if (node.kind === "harness") node.ref.model = payload.model ? "def:" + payload.model : "";
      if (node.kind === "loop") node.ref.harness = payload.harness ? "def:" + payload.harness : "";
      render();
      reinspect();
    } });
  const reinspect = () => { const node = inspect.current(); if (node && nodes.get(node.key) === node) inspect.open(node); else inspect.close(); };

  // ---- 소유 범위 ---------------------------------------------------------------
  const ownerOf = (node) => node.record ? { scope: node.record.scope, project: node.record.project ?? null, team: node.record.team ?? null } : node.owner;
  const sameOwner = (a, b) => a.scope === b.scope && (a.project ?? null) === (b.project ?? null) && (a.team ?? null) === (b.team ?? null);
  const availableToProject = (owner) => owner.scope === "personal" ||
    Boolean(project && ((owner.scope === "project" && owner.project === project.id) || (owner.scope === "team" && owner.team === project.team)));
  const availableToOwner = (target, owner) => owner.scope === "project" ? availableToProject(target) : target.scope === "personal" || sameOwner(target, owner);
  function ownerFor(scope) {
    if (scope === "team" && project?.team) return { scope, project: null, team: project.team };
    if (scope === "project" && project) return { scope, project: project.id, team: null };
    return { scope: "personal", project: null, team: null };
  }
  function scopeChoices() {
    const list = [["personal", "개인 · 모든 프로젝트"]];
    if (project?.team) list.push(["team", "팀 · " + project.team]);
    if (project && !project.archived) list.push(["project", "프로젝트 · " + project.name]);
    return list;
  }
  // 연결 가능 여부. 문제가 있으면 이유를 돌려준다.
  function linkProblem(source, target, slot) {
    const blocked = evaluationFlowBlock(source, target, slot);
    if (blocked) return blocked;
    if (!source || !target || source === target) return "서로 다른 노드를 연결하세요.";
    if (slot === "flow") {
      if (source.kind !== "step" || target.kind !== "step") return "실행 순서는 Workflow 단계끼리 연결합니다.";
      if (target.data.type === "start") return "Start에는 입력을 연결할 수 없습니다.";
      return "";
    }
    if (source.kind !== slot) return `${TYPE_LABELS[slot]} 입력에는 ${TYPE_LABELS[slot]} 노드만 연결합니다.`;
    if (slot === "profile") return "";
    const from = ownerOf(source), to = target.kind === "step" ? null : ownerOf(target);
    if (target.kind === "harness" && !sameOwner(from, to)) return "하네스와 모델은 같은 저장 범위여야 합니다.";
    if (target.kind === "loop" && !availableToOwner(from, to)) return "이 루프의 저장 범위에서는 쓸 수 없는 하네스입니다.";
    if (target.kind === "step" && !availableToProject(from)) return "이 프로젝트에서 쓸 수 없는 정의입니다.";
    return "";
  }

  // ---- 노드 상태 ---------------------------------------------------------------
  const fingerprint = (node) => JSON.stringify([node.draft, node.ref, node.owner ?? null]);
  const isDirty = (node) => node.kind !== "step" && (node.isNew || fingerprint(node) !== node.initial);
  const libraryNodes = () => [...nodes.values()].filter(({ kind }) => kind !== "step");
  const steps = () => [...nodes.values()].filter(({ kind }) => kind === "step");
  const stepById = (id) => nodes.get("step:" + id);
  const nameOf = (node) => node.kind === "step" ? node.data.label : node.draft.name || "(이름 없음)";
  function labelOf(node) {
    if (node.kind === "step") return node.data.label;
    const owner = ownerOf(node);
    const prefix = node.kind === "profile" ? "" : "[" + (owner.scope === "team" ? "팀 · " + owner.team : SCOPE_LABELS[owner.scope]) + "] ";
    return prefix + nameOf(node) + (node.isNew ? " (저장 전)" : "");
  }
  function libraryNode(kind, record, payload) {
    const key = kind === "profile" ? "profile:" + record.id : "def:" + record.id;
    const draft = structuredClone(payload);
    const ref = {};
    if (kind === "harness") ref.model = draft.model ? "def:" + draft.model : "";
    if (kind === "loop") ref.harness = draft.harness ? "def:" + draft.harness : "";
    const spot = spots()[key];
    const node = { key, kind, record, draft, ref, x: spot?.x, y: spot?.y };
    node.collapsed = spot ? Boolean(spot.c) : collapsedByDefault(node);
    node.initial = fingerprint(node);
    return node;
  }
  function syncLibrary() {
    const seen = new Set();
    const keep = (node) => {
      seen.add(node.key);
      const old = nodes.get(node.key);
      if (old && isDirty(old)) { old.record = node.record; return; }
      if (old) Object.assign(node, { x: old.x, y: old.y, collapsed: old.collapsed });
      nodes.set(node.key, node);
    };
    for (const record of defs) keep(libraryNode(record.kind, record, record.payload));
    for (const record of profiles) {
      const { id, version, ...payload } = record;
      keep(libraryNode("profile", record, { name: payload.name, adapter: payload.adapter, provider: payload.provider ?? "",
        model: payload.model ?? "", role: payload.role ?? "", instructions: payload.instructions ?? "" }));
    }
    for (const node of libraryNodes()) if (!node.isNew && !seen.has(node.key)) nodes.delete(node.key);
  }
  function uniqueName(kind, base, owner) {
    const taken = new Set(libraryNodes().filter((node) => node.kind === kind && (kind === "profile" || sameOwner(ownerOf(node), owner)))
      .map((node) => node.draft.name));
    let name = base, index = 2;
    while (taken.has(name)) name = `${base} ${index++}`;
    return name;
  }
  function createLibrary(kind, at, { template, owner = ownerFor("personal"), payload } = {}) {
    const draft = payload ? structuredClone(payload) : blankPayload(kind, catalog, template);
    draft.name = uniqueName(kind, draft.name.slice(0, 236), owner);
    const ref = kind === "harness" ? { model: "" } : kind === "loop" ? { harness: "" } : {};
    const node = { key: "new:" + crypto.randomUUID(), kind, isNew: true, owner, draft, ref,
      x: kind === "harness" && isEvaluationRole(draft.role) ? EXTERNAL_LANE_X : at?.x, y: at?.y };
    if (payload && kind === "harness") ref.model = payload.model ? "def:" + payload.model : "";
    if (payload && kind === "loop") ref.harness = payload.harness ? "def:" + payload.harness : "";
    node.initial = "";
    nodes.set(node.key, node);
    return node;
  }
  function createStep(type, at) {
    const data = blankStep(type, workflows, wf?.record?.id);
    // Workflow 단계는 오른쪽 Workflow 구역에만 둔다(저장 좌표는 0 이상이어야 한다).
    const node = { key: "step:" + data.id, kind: "step", data, ref: {}, x: Math.max(WORKFLOW_X, Math.round(at.x)), y: Math.max(0, Math.round(at.y)) };
    nodes.set(node.key, node);
    return node;
  }

  // ---- Workflow 문서 ↔ 단계 노드 ------------------------------------------------
  function openDocument(record, payload) {
    clearEdgeSelection();
    for (const node of steps()) nodes.delete(node.key);
    if (!payload) { wf = null; return; }
    const profileNodes = new Map(payload.nodes.filter(({ type }) => type === "profile").map((node) => [node.id, node]));
    const profileOf = new Map(payload.edges.filter(({ port }) => port === "profile").map(({ from, to }) => [to, profileNodes.get(from)]));
    for (const raw of payload.nodes) {
      if (raw.type === "profile") continue;
      const data = structuredClone(raw);
      const ref = {};
      let version;
      if ((data.type === "agent" || data.type === "loop") && data.definition) {
        ref[data.type === "agent" ? "harness" : "loop"] = "def:" + data.definition;
        version = data.version;
      }
      delete data.definition;
      delete data.version;
      const node = { key: "step:" + data.id, kind: "step", data, ref, version, x: WORKFLOW_X + (data.x ?? 0) * SX, y: (data.y ?? 0) * SY,
        collapsed: Boolean(layout.steps?.[data.id]) };
      delete data.x;
      delete data.y;
      const profile = profileOf.get(data.id);
      if (profile) {
        ref.profile = "profile:" + profile.profileId;
        node.profileVersion = profile.profileVersion;
        node.profileSpot = { id: profile.id, x: profile.x, y: profile.y };
      }
      nodes.set(node.key, node);
    }
    wf = { record, edges: payload.edges.filter(({ port }) => port !== "profile").map((edge) => ({ ...edge })) };
    workflowName.value = payload.name ?? "";
    wf.initial = JSON.stringify(serialize(false));
  }
  function idOf(key, strict, what) {
    if (!key) return "";
    if (key.startsWith("def:")) return key.slice(4);
    if (key.startsWith("profile:")) return key.slice(8);
    if (strict) throw new Error(`‘${what}’ 노드를 먼저 저장하세요.`);
    return key;
  }
  function serialize(strict) {
    const out = [], edges = wf.edges.map((edge) => ({ ...edge }));
    const groups = new Map();
    for (const node of steps()) {
      const data = structuredClone(node.data);
      data.x = clamp((node.x - WORKFLOW_X) / SX);
      data.y = clamp(node.y / SY);
      if (data.type === "agent" && !node.ref.profile && node.ref.harness) {
        data.definition = idOf(node.ref.harness, strict, nameOf(nodes.get(node.ref.harness) ?? node));
        const version = node.version ?? nodes.get(node.ref.harness)?.record?.version;
        if (version) data.version = version;
      }
      if (data.type === "loop") {
        data.definition = idOf(node.ref.loop, strict, nameOf(nodes.get(node.ref.loop) ?? node));
        const version = node.version ?? nodes.get(node.ref.loop)?.record?.version;
        if (version) data.version = version;
      }
      out.push(data);
      if (data.type === "agent" && node.ref.profile) {
        const profileId = idOf(node.ref.profile, strict, nameOf(nodes.get(node.ref.profile) ?? node));
        const profileVersion = node.profileVersion ?? nodes.get(node.ref.profile)?.record?.version ?? 1;
        const group = profileId + "@" + profileVersion;
        if (!groups.has(group)) {
          const spot = node.profileSpot;
          groups.set(group, { id: spot?.id && ![...groups.values()].some(({ id }) => id === spot.id) ? spot.id : "profile-" + crypto.randomUUID().slice(0, 8),
            type: "profile", label: nameOf(nodes.get(node.ref.profile) ?? node).slice(0, 240), profileId, profileVersion,
            inputs: [], outputs: [], x: spot?.x ?? clamp(data.x), y: spot?.y ?? clamp(data.y + 120) });
        }
        edges.push({ from: groups.get(group).id, to: data.id, port: "profile" });
      }
    }
    return { name: workflowName.value.trim(), nodes: [...out, ...groups.values()], edges };
  }
  const workflowDirty = () => Boolean(wf) && JSON.stringify(serialize(false)) !== wf.initial;
  const dirtyCount = () => libraryNodes().filter(isDirty).length + (workflowDirty() ? 1 : 0);

  // ---- 표시 범위 ---------------------------------------------------------------
  function closure() {
    const keys = new Set(pinned);
    for (const node of nodes.values()) if (node.kind === "step" || isDirty(node)) keys.add(node.key);
    const queue = [...keys];
    while (queue.length) {
      const node = nodes.get(queue.pop());
      for (const key of Object.values(node?.ref ?? {})) if (key && !keys.has(key)) { keys.add(key); queue.push(key); }
    }
    return keys;
  }
  function visibleNodes() {
    if (!wf || mode === "all") return [...nodes.values()];
    const keys = closure();
    return [...nodes.values()].filter(({ key }) => keys.has(key));
  }

  // ---- 연결 -------------------------------------------------------------------
  function links() {
    const list = [];
    for (const node of nodes.values()) {
      for (const [slot, key] of Object.entries(node.ref)) {
        if (key && nodes.has(key)) list.push({ id: `${key}|${slot}|${node.key}`, from: key, fromSlot: slot, to: node.key, toSlot: slot, type: slot });
      }
    }
    for (const edge of wf?.edges ?? []) {
      list.push({ id: `step:${edge.from}|${edge.port}|step:${edge.to}`, from: "step:" + edge.from, fromSlot: edge.port,
        to: "step:" + edge.to, toSlot: "flow", type: "flow", edge });
    }
    return list;
  }
  const hasIncoming = (node) => (wf?.edges ?? []).some(({ to }) => to === node.data.id);
  function setRef(node, slot, key, quiet) {
    if (key) {
      const problem = linkProblem(nodes.get(key), node, slot);
      if (problem) { say(problem, "error"); return false; }
    }
    node.ref[slot] = key;
    if (node.kind === "step") {
      if (slot === "profile") node.profileVersion = key ? nodes.get(key)?.record?.version : undefined;
      else node.version = key ? nodes.get(key)?.record?.version : undefined;
    }
    if (!quiet) say(key ? `${nameOf(nodes.get(key))} → ${nameOf(node)} 연결됨` : "연결을 해제했습니다.");
    return true;
  }
  function removeLink(item) {
    if (item.type === "flow") wf.edges = wf.edges.filter((edge) => edge !== item.edge);
    else setRef(nodes.get(item.to), item.toSlot, "", true);
  }
  function connect(source, target) {
    // source: 출력 {key, slot, type}, target: 입력 {key, slot, type}
    if (source.type !== target.type) { say(`${TYPE_LABELS[source.type]} 출력은 ${TYPE_LABELS[source.type]} 입력에만 연결합니다.`, "error"); return false; }
    const from = nodes.get(source.key), to = nodes.get(target.key);
    if (target.type !== "flow") return setRef(to, target.slot, source.key);
    const problem = linkProblem(from, to, "flow");
    if (problem) { say(problem, "error"); return false; }
    const fromId = from.data.id, toId = to.data.id, port = source.slot;
    if (wf.edges.some((edge) => edge.from === fromId && edge.to === toId && edge.port === port)) return true;
    if (from.data.type !== "parallel") wf.edges = wf.edges.filter((edge) => !(edge.from === fromId && edge.port === port));
    if (!["end", "join"].includes(to.data.type)) wf.edges = wf.edges.filter((edge) => edge.to !== toId);
    wf.edges.push({ from: fromId, to: toId, port });
    say(`${nameOf(from)} → ${nameOf(to)} 연결됨`);
    return true;
  }
  function firstSocket(node, direction, type) {
    const sockets = socketsOf(node)[direction === "in" ? "inputs" : "outputs"];
    return sockets.find((socket) => socket.type === type);
  }
  function connectEnds(origin, other) {
    return origin.dir === "out" ? connect(origin, other) : connect(other, origin);
  }

  // ---- 그리기 -----------------------------------------------------------------
  function socketPoint(key, direction, slot) {
    const socket = nodes.get(key)?.el?.querySelector(`.studio-socket[data-dir="${direction}"][data-slot="${slot}"]`);
    if (!socket?.isConnected) return null;
    const box = socket.getBoundingClientRect();
    return canvas.point(box.left + box.width / 2, box.top + box.height / 2);
  }
  function wire(a, b, type, id, schema) {
    const bend = Math.max(60, Math.abs(b.x - a.x) * .45);
    const d = `M${a.x} ${a.y} C${a.x + bend} ${a.y} ${b.x - bend} ${b.y} ${b.x} ${b.y}`;
    const ns = "http://www.w3.org/2000/svg";
    const group = document.createElementNS(ns, "g");
    group.dataset.type = type;
    if (id) group.dataset.link = id;
    if (id && id === selectedEdge) group.classList.add("is-selected");
    for (const name of ["studio-edge-hit", "studio-edge"]) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", name);
      group.append(path);
    }
    if (schema) {
      group.dataset.schema = schema;
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", (a.x + b.x) / 2);
      text.setAttribute("y", (a.y + b.y) / 2 - 9);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "studio-edge-schema");
      text.textContent = schema;
      group.append(text);
    }
    return group;
  }
  function draw() {
    drawQueued = false;
    const paths = [];
    for (const item of links()) {
      const a = socketPoint(item.from, "out", item.fromSlot), b = socketPoint(item.to, "in", item.toSlot);
      if (a && b) paths.push(wire(a, b, item.type, item.id, item.edge?.schema));
    }
    if (link?.point) {
      const anchor = socketPoint(link.origin.key, link.origin.dir, link.origin.slot);
      if (anchor) paths.push(link.origin.dir === "out" ? wire(anchor, link.point, "preview") : wire(link.point, anchor, "preview"));
    }
    lines.replaceChildren(...paths);
  }
  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(draw);
  }

  // ---- 노드 카드 ---------------------------------------------------------------
  const ctx = {
    catalog: null,
    node: (key) => nodes.get(key),
    scopeChoices,
    workflows: () => workflows,
    currentWorkflow: () => wf?.record?.id ?? "",
    hasIncoming,
    profileModels: (adapter) => profiles.filter((item) => item.adapter === adapter && item.model)
      .map(({ provider, model }) => ({ provider, id: model, name: model })),
    stepChoices: (node) => steps().filter((item) => item !== node && !["start", "end"].includes(item.data.type))
      .map((item) => [item.data.id, item.data.label]),
    changed(node, { title, rerender, refreshInspect } = {}) {
      if (rerender) {
        render();
        if (refreshInspect && inspect.current() === node) reinspect();
        return;
      }
      refreshCard(node, title);
      if (title) renameOptions(node);
      updateToolbar();
    },
    setScope(node, scope) {
      node.owner = ownerFor(scope);
      for (const [slot, key] of Object.entries(node.ref)) if (key && linkProblem(nodes.get(key), node, slot)) node.ref[slot] = "";
      for (const other of nodes.values()) {
        for (const [slot, key] of Object.entries(other.ref)) {
          if (key === node.key && linkProblem(node, other, slot)) { other.ref[slot] = ""; say(`${nameOf(other)}의 ${TYPE_LABELS[slot]} 연결은 저장 범위가 맞지 않아 해제했습니다.`); }
        }
      }
      render();
    },
  };
  function badgeOf(node) {
    if (node.kind === "step") {
      const version = node.version ? " · v" + node.version : "";
      return STEP_TYPES[node.data.type] + version;
    }
    const kind = (node.kind === "harness" ? harnessTypeOf(node.draft.role)?.label : null) ?? KIND_LABELS[node.kind];
    if (node.isNew) return kind + " · 저장 전";
    const owner = ownerOf(node);
    const scope = node.kind === "profile" ? "" : (owner.scope === "team" ? "팀 " + owner.team : SCOPE_LABELS[owner.scope]) + " · ";
    return kind + " · " + scope + "v" + node.record.version;
  }
  function socket(node, direction, spec) {
    const { slot, type, label } = spec;
    const locked = !socketDragAllowed(node, direction, spec);
    return h("span", { class: locked ? "studio-socket is-definition" : "studio-socket",
      title: locked ? "정의 연결 전용 · 실행 흐름으로 끌 수 없습니다" : `${label} ${direction === "in" ? "입력" : "출력"} · 끌어서 연결`,
      dataset: { dir: direction, slot, type, key: node.key, execution: locked ? "0" : "1" },
      onpointerdown: (event) => {
        if (locked) {
          event.preventDefault();
          event.stopPropagation();
          say("평가 하네스는 실행 흐름 밖에 있습니다. 이 출력은 Workflow 단계로 끌 수 없습니다.", "error");
          return;
        }
        startLink(event, node, direction, slot, type);
      } });
  }
  function refOptions(node, slot) {
    return libraryNodes().filter((candidate) => candidate.kind === slot && !linkProblem(candidate, node, slot))
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b), "ko")).map((candidate) => [candidate.key, labelOf(candidate)]);
  }
  function inputRow(node, input) {
    const row = h("div", { class: "studio-in", dataset: { type: input.type } }, socket(node, "in", input), h("span", { class: "studio-slot" }, input.label));
    if (input.type === "flow") return row;
    const current = node.ref[input.slot] ?? "";
    const entries = [["", input.slot === "profile" ? "없음" : "연결 안 됨"], ...refOptions(node, input.slot)];
    if (current && !entries.some(([key]) => key === current)) entries.push([current, nodes.has(current) ? labelOf(nodes.get(current)) : "(사용할 수 없는 정의)"]);
    const picker = h("select", { "aria-label": nameOf(node) + " · " + input.label, onchange: (event) => {
      if (!setRef(node, input.slot, event.target.value)) event.target.value = current;
      render();
    } }, ...entries.map(([key, label]) => h("option", { value: key }, label)));
    picker.value = current;
    if (node.kind === "step" && input.slot === "harness" && node.ref.profile) {
      picker.disabled = true;
      picker.title = "프로필이 연결되어 있어 프로필 설정을 사용합니다.";
    }
    row.append(picker);
    return row;
  }
  function card(node) {
    const { inputs, outputs } = socketsOf(node);
    const type = node.kind === "step" ? node.data.type : node.kind;
    const external = isEvaluationHarness(node);
    const title = h("strong", { class: "studio-title" }, nameOf(node));
    const head = h("header", { class: "studio-head", title: node.kind === "step" ? STEP_HINTS[type] ?? "" : "" },
      h("button", { type: "button", class: "studio-collapse", "aria-label": node.collapsed ? "펼치기" : "접기",
        "aria-expanded": String(!node.collapsed), onclick: () => toggleCollapse(node) }, node.collapsed ? "▸" : "▾"),
      h("span", { class: "studio-head-text" }, title, h("small", { class: "studio-badge" }, badgeOf(node))),
      h("span", { class: "studio-dirty", title: "저장하지 않은 변경", hidden: !isDirty(node) }, "●"),
      h("button", { type: "button", class: "studio-more", "aria-label": nameOf(node) + " 메뉴", onclick: (event) => nodeMenu(event, node) }, "⋯"));
    head.addEventListener("pointerdown", (event) => startMove(event, node));
    head.addEventListener("dblclick", (event) => { if (!event.target.closest("button")) toggleCollapse(node); });
    const io = h("div", { class: "studio-io" },
      h("div", { class: "studio-inputs" }, ...inputs.map((input) => inputRow(node, input))),
      h("div", { class: "studio-outputs" }, ...outputs.map((output) => h("div", { class: "studio-out", dataset: { type: output.type } },
        h("span", { class: "studio-slot" }, output.label), socket(node, "out", output)))));
    const contract = node.kind === "harness" ? harnessContractDetails(node.draft.role, { visible: true }) : null;
    const banner = external ? h("p", { class: "studio-external-label" }, EXTERNAL_LANE_LABEL) : null;
    const body = h("div", { class: "studio-body" }, ...widgetsOf(node, ctx));
    const problems = h("ul", { class: "studio-problems" });
    const foot = node.kind === "step" ? null : h("footer", { class: "studio-foot" },
      h("button", { type: "button", class: "studio-save", disabled: !isDirty(node), onclick: guard(() => saveNode(node)) }, node.isNew ? "저장" : "새 버전 저장"),
      node.isNew ? null : h("button", { type: "button", class: "studio-mini", hidden: !isDirty(node), onclick: () => revert(node) }, "되돌리기"));
    const root = h("article", { class: external ? "studio-node is-external" : "studio-node",
      dataset: { key: node.key, kind: node.kind, type, ...(external ? { external: "1" } : {}) }, tabIndex: -1 },
      head, banner, io, contract, body, problems, foot);
    root.classList.toggle("is-collapsed", Boolean(node.collapsed));
    root.classList.toggle("is-selected", selected === node.key);
    root.addEventListener("pointerdown", (event) => {
      select(node.key);
      // 제목 끌기는 기본 동작을 막으므로 포커스를 직접 옮겨 Delete 키가 동작하게 한다.
      if (!event.target.closest("input, textarea, select, button, summary")) root.focus({ preventScroll: true });
    }, true);
    node.el = root;
    node.problems = problems;
    node.title = title;
    place(node);
    paintProblems(node);
    resize.observe(root);
    return root;
  }
  function place(node) {
    if (!node.el || node.x === undefined) return;
    node.el.style.left = node.x + "px";
    node.el.style.top = node.y + "px";
  }
  function paintProblems(node) {
    const list = problemsOf(node, ctx);
    node.problems.replaceChildren(...list.map((text) => h("li", {}, text)));
    node.problems.hidden = !list.length;
    node.el.classList.toggle("has-problem", list.length > 0);
  }
  // 이름을 바꾸면 다른 노드의 셀렉트 항목 이름도 바로 바꾼다(다시 그리지 않아 입력 포커스를 지킨다).
  function renameOptions(node) {
    const value = node.kind === "step" ? node.data.id : node.key;
    for (const option of layer.querySelectorAll("option")) {
      if (option.value === value) option.textContent = node.kind === "step" ? node.data.label : labelOf(node);
    }
  }
  function refreshCard(node, title) {
    if (!node.el) return;
    if (title) node.title.textContent = nameOf(node);
    const dirty = isDirty(node);
    node.el.querySelector(".studio-dirty").hidden = !dirty;
    const save = node.el.querySelector(".studio-save");
    if (save) save.disabled = !dirty;
    const revertButton = node.el.querySelector(".studio-foot .studio-mini");
    if (revertButton) revertButton.hidden = !dirty;
    paintProblems(node);
  }
  function render() {
    resize.disconnect();
    for (const node of nodes.values()) if (isEvaluationHarness(node) && node.x !== undefined) node.x = EXTERNAL_LANE_X;
    const visible = visibleNodes().sort((a, b) => (a.kind === "step") - (b.kind === "step"));
    for (const node of nodes.values()) node.el = null;
    layer.replaceChildren(...visible.map(card));
    placePending();
    el("empty").hidden = visible.length > 0;
    updateToolbar();
    scheduleDraw();
  }
  // 위치가 없는 정의 노드를 자기 열(모델·하네스·루프/프로필)에 놓는다. 오른쪽 열부터 놓아 쓰는 노드 높이에 맞춘다.
  function placePending(list = visibleNodes().filter((node) => node.el && node.kind !== "step" && node.x === undefined)) {
    if (!list.length) return;
    const pending = new Set(list);
    for (const node of list) { node.x = undefined; node.y = undefined; }
    const anchor = (node) => {
      const users = [...nodes.values()].filter((other) => other.el && other.y !== undefined && Object.values(other.ref).includes(node.key));
      return users.length ? Math.min(...users.map(({ y }) => y)) : Infinity;
    };
    const external = list.filter((node) => isEvaluationHarness(node));
    const grid = list.filter((node) => node.kind === "profile" && !linkedProfile(node));
    for (const kinds of [["loop", "profile"], ["harness"], ["model"]]) {
      const column = list.filter((node) => kinds.includes(node.kind) && !grid.includes(node) && !external.includes(node));
      if (!column.length) continue;
      for (const node of column) node.anchor = anchor(node);
      column.sort((a, b) => a.anchor - b.anchor || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || nameOf(a).localeCompare(nameOf(b), "ko"));
      const x = COLUMN[column[0]?.kind];
      const fixed = [...nodes.values()].filter((other) => other.el && other.kind !== "step" && !pending.has(other) &&
        other.x !== undefined && Math.abs(other.x - x) < 200);
      let bottom = -GAP;
      for (const node of column) {
        let y = Math.max(bottom + GAP, Number.isFinite(node.anchor) ? node.anchor : 0);
        const height = node.el.offsetHeight;
        // 이미 자리를 잡은 노드와 겹치면 아래로 밀어 낸다.
        for (const other of fixed.sort((a, b) => a.y - b.y)) {
          if (y < other.y + other.el.offsetHeight + GAP && y + height + GAP > other.y) y = other.y + other.el.offsetHeight + GAP;
        }
        node.x = COLUMN[node.kind];
        node.y = y;
        bottom = y + height;
        place(node);
        remember(node);
      }
    }
    if (external.length) {
      for (const node of external) node.anchor = anchor(node);
      external.sort((a, b) => a.anchor - b.anchor || nameOf(a).localeCompare(nameOf(b), "ko"));
      const fixed = [...nodes.values()].filter((other) => other.el && other.kind !== "step" && !pending.has(other) &&
        other.x !== undefined && Math.abs(other.x - EXTERNAL_LANE_X) < 200);
      let bottom = -GAP;
      for (const node of external) {
        let y = Math.max(bottom + GAP, Number.isFinite(node.anchor) ? node.anchor : 0);
        const height = node.el.offsetHeight;
        for (const other of fixed.sort((a, b) => a.y - b.y)) {
          if (y < other.y + other.el.offsetHeight + GAP && y + height + GAP > other.y) y = other.y + other.el.offsetHeight + GAP;
        }
        node.x = EXTERNAL_LANE_X;
        node.y = y;
        bottom = y + height;
        place(node);
        remember(node);
      }
    }
    placeGrid(grid.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko")));
    saveLayout();
  }
  // 연결되지 않은 프로필을 이미 놓인 정의 노드 아래에 여러 열로 놓는다(한 열로 길게 쌓여 화면이 작아지지 않게).
  function placeGrid(list) {
    if (!list.length) return;
    const pending = new Set(list);
    const placed = [...nodes.values()].filter((other) => other.el && other.kind !== "step" && !pending.has(other) && other.x !== undefined);
    let top = !placed.length ? 0 : wf ? Math.max(...placed.map((other) => other.y + other.el.offsetHeight)) + GAP * 2
      : Math.min(...placed.map((other) => other.y));
    const columns = wf ? GRID_WORKFLOW : GRID_LIBRARY;
    for (let start = 0; start < list.length; start += columns.length) {
      const row = list.slice(start, start + columns.length);
      row.forEach((node, index) => { node.x = columns[index]; node.y = top; place(node); remember(node); });
      top += Math.max(...row.map((node) => node.el.offsetHeight)) + GAP;
    }
  }
  // 정의 노드 위치는 보는 맥락(Workflow별, 또는 Workflow 없이 정의만)마다 따로 기억한다.
  function spots() {
    const context = wf ? "wf:" + (wf.record?.id ?? "new") : "library";
    layout.contexts ??= {};
    return layout.contexts[context] ??= {};
  }
  function applySpots() {
    const table = spots(), linked = wf ? closure() : null;
    for (const node of libraryNodes()) {
      const spot = table[node.key];
      Object.assign(node, { x: spot?.x, y: spot?.y, collapsed: spot ? Boolean(spot.c) : collapsedByDefault(node, linked) });
    }
  }
  // 처음 보는 정의 노드의 접힘 상태. 정의만 볼 때는 모두 접어 목록처럼 훑어 보게 하고,
  // Workflow 를 열었을 때는 그 Workflow 에 연결되지 않은 정의('전체 정의'에서만 보임)만 접는다(연결된 정의는 바로 고칠 수 있게 펼친다).
  function collapsedByDefault(node, linked = wf ? closure() : null) {
    if (node.isNew) return false;
    return !linked || !linked.has(node.key);
  }
  function linkedProfile(node) { return steps().some((step) => step.ref.profile === node.key); }
  function remember(node) {
    if (node.kind === "step") {
      layout.steps ??= {};
      if (node.collapsed) layout.steps[node.data.id] = 1; else delete layout.steps[node.data.id];
    } else if (node.x !== undefined) spots()[node.key] = { x: Math.round(node.x), y: Math.round(node.y), c: node.collapsed ? 1 : 0 };
  }
  function saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* 저장 공간이 없으면 위치만 잃는다 */ }
  }
  function toggleCollapse(node) {
    node.collapsed = !node.collapsed;
    remember(node);
    saveLayout();
    render();
  }
  function clearEdgeSelection() {
    selectedEdge = "";
    if (el("inspect").querySelector("[data-handoff-editor]")) inspect.close();
  }
  function select(key) {
    selected = key;
    clearEdgeSelection();
    for (const item of layer.children) item.classList.toggle("is-selected", item.dataset.key === key);
    scheduleDraw();
  }
  function inspectHandoff({ edge }) {
    const source = stepById(edge.from), target = stepById(edge.to);
    const ids = new Set();
    const outputs = Array.isArray(source.data.outputs) ? source.data.outputs.slice(0, 16) : [];
    const inputs = Array.isArray(target.data.inputs) ? target.data.inputs.slice(0, 16) : [];
    for (const output of outputs) {
      if (typeof output?.name === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(output.name) &&
          inputs.some((input) => input?.source === edge.from && input.artifact === output.name)) ids.add(output.name);
    }
    const choice = h("select", { "aria-label": "인계 스키마" }, h("option", { value: "" }, "없음 (실행 순서만)"),
      ...[...ids].map((id) => h("option", { value: id }, id)));
    if (edge.schema && !ids.has(edge.schema)) choice.append(h("option", { value: edge.schema }, edge.schema + " (입출력 불일치)"));
    choice.value = edge.schema ?? "";
    choice.addEventListener("change", () => {
      if (choice.value) edge.schema = choice.value;
      else delete edge.schema;
      scheduleDraw();
      updateToolbar();
      say("인계 스키마를 변경했습니다. 검사 또는 저장 시 하네스 계약을 확인합니다.");
    });
    const close = h("button", { type: "button", class: "studio-mini", onclick: () => { clearEdgeSelection(); scheduleDraw(); } }, "닫기");
    inspect.close();
    const root = el("inspect");
    root.append(h("section", { "data-handoff-editor": "" },
      h("header", { class: "studio-inspect-head" }, h("span", {}, h("strong", {}, "인계 스키마"),
        h("small", {}, `${nameOf(source)} → ${nameOf(target)}`)), close),
      h("label", { class: "studio-inspect-row" }, "산출물 스키마 ID", choice),
      h("p", {}, "이 간선의 송신 산출물 이름을 선택하세요. 저장된 하네스의 JSON 결과 파일을 송신 단계에 선언하고, 수신 하네스가 사용하는 입력으로 연결해야 합니다."),
      ids.size ? null : h("p", {}, "두 단계의 ‘산출물 입출력’에서 먼저 같은 산출물을 연결하세요.")));
    root.hidden = false;
  }

  // ---- 끌기: 노드 이동·연결 ------------------------------------------------------
  function startMove(event, node) {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    const origin = canvas.point(event.clientX, event.clientY), start = { x: node.x, y: node.y };
    const move = (moveEvent) => {
      const point = canvas.point(moveEvent.clientX, moveEvent.clientY);
      node.x = isEvaluationHarness(node) ? EXTERNAL_LANE_X
        : Math.max(node.kind === "step" ? WORKFLOW_X : -4000, Math.round(start.x + point.x - origin.x));
      node.y = Math.max(node.kind === "step" ? 0 : -4000, Math.round(start.y + point.y - origin.y));
      place(node);
      scheduleDraw();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      if (node.x !== start.x || node.y !== start.y) {
        if (node.kind === "step") updateToolbar();
        else { remember(node); saveLayout(); }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }
  function startLink(event, node, direction, slot, type) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (link) { finishLink(event); return; }
    let origin = { key: node.key, dir: direction, slot, type };
    if (direction === "in") {
      // 이미 연결된 입력을 끌면 그 연결을 떼어 다른 곳에 꽂는다(ComfyUI 방식).
      const existing = links().filter((item) => item.to === node.key && item.toSlot === slot).pop();
      if (existing) {
        removeLink(existing);
        origin = { key: existing.from, dir: "out", slot: existing.fromSlot, type };
        render();
      }
    }
    link = { origin, point: canvas.point(event.clientX, event.clientY), startX: event.clientX, startY: event.clientY };
    viewport.classList.add("is-linking");
    viewport.dataset.linking = type;
    if (isEvaluationHarness(nodes.get(origin.key)) && origin.dir === "out") viewport.dataset.linkOrigin = "evaluation";
    else if (node.kind === "step" && type === "harness") viewport.dataset.linkOrigin = "step";
    else delete viewport.dataset.linkOrigin;
    const move = (moveEvent) => { link.point = canvas.point(moveEvent.clientX, moveEvent.clientY); scheduleDraw(); };
    const up = (upEvent) => {
      const still = Math.abs(upEvent.clientX - link.startX) < 4 && Math.abs(upEvent.clientY - link.startY) < 4;
      if (still) {
        // 클릭만 했으면 다음 클릭 위치에 연결한다.
        say(`${TYPE_LABELS[type]} 연결 중 · 연결할 소켓이나 노드를 누르세요. Esc로 취소`);
        const next = (downEvent) => { downEvent.stopPropagation(); downEvent.preventDefault(); finishLink(downEvent); };
        window.addEventListener("pointerdown", next, { once: true, capture: true });
        const previous = link.cleanup;
        link.cleanup = () => { previous(); window.removeEventListener("pointerdown", next, true); };
        return;
      }
      finishLink(upEvent);
    };
    link.cleanup = () => { window.removeEventListener("pointermove", move); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    scheduleDraw();
  }
  function cancelLink() {
    if (!link) return;
    link.cleanup?.();
    link = null;
    viewport.classList.remove("is-linking");
    delete viewport.dataset.linking;
    delete viewport.dataset.linkOrigin;
    scheduleDraw();
  }
  function finishLink(event) {
    const current = link;
    cancelLink();
    if (!current) return;
    const { origin } = current;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const socketElement = target?.closest(".studio-socket");
    const cardElement = target?.closest(".studio-node");
    if (socketElement && socketElement.dataset.dir !== origin.dir) {
      const other = { key: socketElement.dataset.key, slot: socketElement.dataset.slot, type: socketElement.dataset.type };
      if (connectEnds(origin, other)) render();
    } else if (cardElement && cardElement.dataset.key !== origin.key) {
      const node = nodes.get(cardElement.dataset.key);
      const match = firstSocket(node, origin.dir === "out" ? "in" : "out", origin.type);
      if (!match) say(`${nameOf(node)}에는 ${TYPE_LABELS[origin.type]} ${origin.dir === "out" ? "입력" : "출력"}이 없습니다.`, "error");
      else if (connectEnds(origin, { key: node.key, slot: match.slot, type: match.type })) render();
    } else if (!cardElement && viewport.contains(target)) {
      openMenu(event.clientX, event.clientY, origin);
    } else render();
  }

  // ---- 노드 추가 메뉴 ------------------------------------------------------------
  function menuItems(origin) {
    const items = [];
    // 정의 노드에서 끌어 만든 새 정의는 같은 저장 범위로 만든다(하네스-모델은 같은 범위여야 연결된다).
    const source = origin && nodes.get(origin.key);
    const owner = source && ["model", "harness", "loop"].includes(source.kind) ? ownerOf(source) : null;
    const libraryOwner = () => owner ? { ...owner } : ownerFor("personal");
    items.push({ group: "정의", label: "새 모델", hint: "모델과 추론 수준", out: "model", in: [],
      create: (at) => createLibrary("model", at, { owner: libraryOwner() }) });
    for (const [template, [role]] of Object.entries(HARNESS_TEMPLATES)) {
      items.push({ group: "정의", label: "새 하네스 · " + role, hint: "역할·작업 지시·규칙·스킬", out: "harness", in: ["model"],
        create: (at) => createLibrary("harness", at, { template, owner: libraryOwner() }) });
    }
    items.push({ group: "정의", label: "새 하네스 · 빈 하네스", hint: "직접 작성", out: "harness", in: ["model"],
      create: (at) => createLibrary("harness", at, { owner: libraryOwner() }) });
    items.push({ group: "정의", label: "새 루프", hint: "재시도·검증 명령·예산", out: "loop", in: ["harness"],
      create: (at) => createLibrary("loop", at, { owner: libraryOwner() }) });
    items.push({ group: "정의", label: "새 에이전트 프로필", hint: "실행기·모델·역할", out: "profile", in: [],
      create: (at) => createLibrary("profile", at, { owner: ownerFor("personal") }) });
    for (const family of HARNESS_CATALOG.families) {
      for (const type of HARNESS_CATALOG.types.filter((type) => type.family === family.id)) {
        items.push({ group: family.label, label: type.label, hint: type.output, search: `새 하네스 ${type.id} ${type.outputSchema}`,
          out: "harness", in: ["model"], evaluation: type.id === "evaluation",
          create: (at) => createLibrary("harness", at, { template: type.id, owner: libraryOwner() }) });
      }
    }
    if (wf) {
      for (const type of ["agent", "loop", "command", "condition", "approval", "parallel", "join", "subgraph", "end"]) {
        if (type === "end" && steps().some(({ data }) => data.type === "end")) continue;
        items.push({ group: "Workflow 단계", label: STEP_TYPES[type], hint: STEP_HINTS[type] ?? "", out: type === "end" ? null : "flow",
          in: ["flow", ...(type === "agent" ? ["harness", "profile"] : type === "loop" ? ["loop"] : [])], create: (at) => createStep(type, at) });
      }
    }
    const shown = new Set(visibleNodes().map(({ key }) => key));
    for (const node of libraryNodes().filter(({ key }) => !shown.has(key))) {
      const type = node.kind === "harness" ? harnessTypeOf(node.draft.role) : null;
      items.push({ group: "저장된 정의 불러오기", label: labelOf(node), hint: (type?.label ?? KIND_LABELS[node.kind]) + " · v" + (node.record?.version ?? "-"),
        search: type ? `${type.id} ${type.outputSchema}` : "", out: node.kind, in: Object.keys(node.ref),
        evaluation: isEvaluationHarness(node),
        create: (at) => {
          pinned.add(node.key);
          node.x = isEvaluationHarness(node) ? EXTERNAL_LANE_X : at.x;
          node.y = at.y;
          remember(node);
          saveLayout();
          return node;
        } });
    }
    if (!origin) {
      if (desktop()) items.push({ group: "빠른 시작", label: "기본 구성 추가", hint: "기본 모델·하네스·루프·프로필을 개인 범위에 추가", out: null, in: [],
        create: () => { void addDefaults(); return null; } });
      return items;
    }
    const originNode = nodes.get(origin.key);
    const externalOut = origin.dir === "out" && isEvaluationHarness(originNode);
    const stepHarnessIn = origin.dir === "in" && origin.type === "harness" && originNode?.kind === "step";
    return items.filter((item) => {
      if (origin.dir === "out") {
        if (externalOut && item.group === "Workflow 단계") return false;
        return item.in.includes(origin.type);
      }
      if (stepHarnessIn && item.evaluation) return false;
      return item.out === origin.type;
    });
  }
  let menuState = null;
  function openMenu(clientX, clientY, origin) {
    const bounds = el("graph").getBoundingClientRect();
    menuState = { at: canvas.point(clientX, clientY), origin, items: menuItems(origin) };
    menu.hidden = false;
    menu.style.left = Math.min(clientX - bounds.left, bounds.width - 300) + "px";
    menu.style.top = Math.min(clientY - bounds.top, bounds.height - 360) + "px";
    el("menu-title").textContent = origin ? `${TYPE_LABELS[origin.type]} ${origin.dir === "out" ? "출력에 연결할" : "입력에 연결할"} 노드` : "노드 추가";
    menuSearch.hidden = false;
    menuSearch.value = "";
    paintMenu();
    menuSearch.focus();
  }
  function paintMenu() {
    if (!menuState) return;
    const query = menuSearch.value.trim().toLowerCase();
    const items = menuState.items.filter(({ label, hint, group, search = "" }) => !query || `${label} ${hint} ${group} ${search}`.toLowerCase().includes(query));
    let group = "";
    const rows = [];
    items.forEach((item, index) => {
      if (item.group !== group) { group = item.group; rows.push(h("li", { class: "studio-menu-group", role: "presentation" }, group)); }
      rows.push(h("li", { role: "none" }, h("button", { type: "button", role: "menuitem", class: index === 0 ? "is-first" : "",
        onclick: () => pick(item) }, h("span", {}, item.label), h("small", {}, item.hint))));
    });
    if (!items.length) rows.push(h("li", { class: "studio-menu-group" }, "맞는 노드가 없습니다."));
    menuList.replaceChildren(...rows);
    menuState.filtered = items;
  }
  function pick(item) {
    const { at, origin } = menuState;
    closeMenu();
    const node = item.create(at);
    if (!node) return;
    if (origin) {
      const match = firstSocket(node, origin.dir === "out" ? "in" : "out", origin.type);
      if (match) connectEnds(origin, { key: node.key, slot: match.slot, type: match.type });
    }
    selected = node.key;
    render();
    say(`${nameOf(node)} 노드를 추가했습니다.` + (node.isNew ? " 노드 아래 ‘저장’ 또는 위의 ‘변경 저장’으로 저장하세요." : ""));
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menuState = null;
  }
  menuSearch.addEventListener("input", paintMenu);
  menuSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && menuState?.filtered?.length) { event.preventDefault(); pick(menuState.filtered[0]); }
    if (event.key === "Escape") { closeMenu(); viewport.focus(); }
  });

  // ---- 노드 메뉴 ---------------------------------------------------------------
  function nodeMenu(event, node) {
    event.stopPropagation();
    const items = [];
    if (node.kind === "step") {
      if (!["start", "end"].includes(node.data.type)) {
        items.push(["복제", () => {
          const copy = createStep(node.data.type, { x: node.x + 40, y: node.y + 40 });
          Object.assign(copy.data, structuredClone({ ...node.data, id: copy.data.id, label: node.data.label + " 복제" }));
          copy.ref = { ...node.ref };
          copy.version = node.version;
          copy.profileVersion = node.profileVersion;
          return copy;
        }], ["단계 삭제", () => removeNode(node)]);
      }
    } else {
      items.push(["복제", () => {
        const payload = structuredClone(node.draft);
        payload.name = node.draft.name + " 복제";
        const copy = createLibrary(node.kind, { x: node.x + 40, y: node.y + 40 }, { owner: { ...ownerOf(node) }, payload });
        copy.ref = { ...node.ref };
        return copy;
      }]);
      items.push([node.kind === "harness" ? "상세 · 버전 기록 · 실제 적용값 · 비교 실행" : "상세 · 버전 기록", () => { select(node.key); inspect.open(node); }]);
      if (isDirty(node) && !node.isNew) items.push(["되돌리기", () => revert(node)]);
      if (wf && mode !== "all" && pinned.has(node.key)) items.push(["캔버스에서 숨기기", () => { pinned.delete(node.key); render(); }]);
      items.push([node.isNew ? "삭제(저장 안 함)" : node.kind === "profile" ? "프로필 삭제" : "정의 삭제", () => removeNode(node)]);
    }
    const bounds = el("graph").getBoundingClientRect();
    menuState = { at: { x: node.x, y: node.y }, items: [] };
    menu.hidden = false;
    menu.style.left = Math.min(event.clientX - bounds.left, bounds.width - 300) + "px";
    menu.style.top = Math.min(event.clientY - bounds.top, bounds.height - 200) + "px";
    el("menu-title").textContent = nameOf(node);
    menuSearch.hidden = true;
    menuList.replaceChildren(...items.map(([label, run]) => h("li", { role: "none" }, h("button", { type: "button", role: "menuitem",
      onclick: guard(async () => {
        closeMenu();
        const result = await run();
        if (result?.key) { selected = result.key; render(); }
      }) }, h("span", {}, label)))));
    menuList.querySelector("button")?.focus();
  }
  const menuObserver = new MutationObserver(() => { if (menu.hidden) menuSearch.hidden = false; });
  menuObserver.observe(menu, { attributes: true, attributeFilter: ["hidden"] });

  // ---- 저장·삭제 ---------------------------------------------------------------
  async function profileRequest(input) {
    const response = await fetch("/api/session-harnesses", input === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("프로필 요청 실패 (" + response.status + ")");
    const result = await response.json();
    if (!result.ok) throw new Error(result.out);
    return result;
  }
  function rekey(node, key) {
    if (node.key === key) return;
    const old = node.key;
    nodes.delete(old);
    node.key = key;
    nodes.set(key, node);
    for (const other of nodes.values()) for (const [slot, value] of Object.entries(other.ref)) if (value === old) other.ref[slot] = key;
    if (pinned.delete(old)) pinned.add(key);
    if (selected === old) selected = key;
  }
  function payloadOf(node) {
    if (Object.keys(node.errors ?? {}).length) throw new Error(`${nameOf(node)}: ${Object.values(node.errors)[0]}`);
    if (node.kind === "model") {
      if (!node.draft.model) throw new Error(`${nameOf(node)}: 모델을 고르세요.`);
      return { name: node.draft.name, provider: node.draft.provider, model: node.draft.model, reasoning: node.draft.reasoning ?? "" };
    }
    if (node.kind === "harness") {
      if (!node.ref.model) throw new Error(`${nameOf(node)}: 모델 노드를 연결하세요.`);
      return { ...node.draft, model: idOf(node.ref.model, true, nameOf(nodes.get(node.ref.model))) };
    }
    if (!node.ref.harness) throw new Error(`${nameOf(node)}: 하네스 노드를 연결하세요.`);
    return { ...node.draft, harness: idOf(node.ref.harness, true, nameOf(nodes.get(node.ref.harness))) };
  }
  async function saveNode(node, { batch } = {}) {
    if (!isDirty(node)) return;
    for (const key of Object.values(node.ref)) {
      const target = nodes.get(key);
      if (target?.isNew) await saveNode(target, { batch: true });
    }
    const previous = node.record?.version;
    if (node.kind === "profile") {
      const { profile } = await profileRequest({ ...node.draft, id: node.record?.id, version: node.record?.version });
      node.record = profile;
      node.draft = { name: profile.name, adapter: profile.adapter, provider: profile.provider ?? "", model: profile.model ?? "",
        role: profile.role ?? "", instructions: profile.instructions ?? "" };
      rekey(node, "profile:" + profile.id);
      profiles = [...profiles.filter(({ id }) => id !== profile.id), profile];
      profilesChanged?.(profiles);
    } else {
      if (!desktop()) throw new Error("데스크톱 앱에서 Engineering을 열어 주세요.");
      const owner = ownerOf(node);
      const saved = await request("definitions", {}, { scope: owner.scope, project: owner.project ?? undefined, team: owner.team ?? undefined,
        kind: node.kind, payload: payloadOf(node), id: node.record?.id, version: node.record?.version });
      node.record = saved;
      node.draft = structuredClone(saved.payload);
      rekey(node, "def:" + saved.id);
      defs = [...defs.filter(({ id }) => id !== saved.id), saved];
    }
    node.isNew = false;
    delete node.owner;
    delete node.raw;
    delete node.errors;
    node.initial = fingerprint(node);
    remember(node);
    saveLayout();
    // 이전 최신 버전에 고정돼 있던 Workflow 단계는 새 버전을 따라간다(Workflow 저장 전까지는 초안).
    let bumped = 0;
    for (const step of steps()) {
      const slot = node.kind === "profile" ? "profile" : node.kind;
      if (step.ref[slot] !== node.key) continue;
      if (slot === "profile" ? (step.profileVersion ?? previous) === previous : (step.version ?? previous) === previous) {
        if (slot === "profile") step.profileVersion = node.record.version; else step.version = node.record.version;
        bumped++;
      }
    }
    if (!batch) {
      render();
      reinspect();
      say(`${nameOf(node)} · v${node.record.version} 저장됨` + (bumped ? ` · Workflow 단계 ${bumped}개가 새 버전을 쓰도록 바뀌었습니다(Workflow 저장 필요).` : ""), "ok");
      notifyChanged?.();
    }
  }
  async function saveAll() {
    if (busy) return;
    busy = true;
    el("save").disabled = true;
    try {
      const queue = libraryNodes().filter(isDirty).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      let count = 0;
      for (const node of queue) {
        if (!isDirty(node)) continue;
        await saveNode(node, { batch: true });
        count++;
      }
      let message = count ? `정의·프로필 ${count}개 저장` : "";
      if (workflowDirty()) {
        const saved = await saveWorkflow(true);
        message += (message ? " · " : "") + `Workflow ‘${saved.name}’ v${saved.version} 저장`;
      }
      render();
      if (count) reinspect();
      say(message ? message + "됨" : "저장할 변경이 없습니다.", message ? "ok" : "");
      if (count) notifyChanged?.();
    } finally {
      busy = false;
      updateToolbar();
    }
  }
  async function saveWorkflow(batch) {
    if (!project) throw new Error("작업 프로젝트를 선택하세요.");
    if (!workflowName.value.trim()) { workflowName.focus(); throw new Error("Workflow 이름을 입력하세요."); }
    const owner = project.id;
    const saved = await request("workflows", {}, { project: owner, payload: serialize(true), id: wf.record?.id, version: wf.record?.version });
    if (owner !== project?.id) return saved;
    await loadWorkflows();
    const before = spots();
    openDocument(saved, saved.payload);
    if (spots() !== before) Object.assign(spots(), before);
    fillWorkflowPicker(saved.id);
    if (!batch) { render(); say(`Workflow ‘${saved.name}’ v${saved.version} 저장됨`, "ok"); }
    notifyChanged?.();
    return saved;
  }
  function revert(node) {
    if (node.isNew) return;
    const fresh = node.kind === "profile" ? libraryNode("profile", node.record, {
      name: node.record.name, adapter: node.record.adapter, provider: node.record.provider ?? "", model: node.record.model ?? "",
      role: node.record.role ?? "", instructions: node.record.instructions ?? "" }) : libraryNode(node.kind, node.record, node.record.payload);
    Object.assign(fresh, { x: node.x, y: node.y, collapsed: node.collapsed });
    nodes.set(node.key, fresh);
    render();
    say(`${nameOf(fresh)}을(를) 저장된 v${fresh.record.version}으로 되돌렸습니다.`);
  }
  async function removeNode(node) {
    if (node.kind === "step") {
      const id = node.data.id;
      wf.edges = wf.edges.filter(({ from, to }) => from !== id && to !== id);
      for (const step of steps()) if (step.data.source === id) step.data.source = "";
      nodes.delete(node.key);
      render();
      say(`${nameOf(node)} 단계를 지웠습니다. Workflow를 저장해야 반영됩니다.`);
      return;
    }
    const users = [...nodes.values()].filter((other) => Object.values(other.ref).includes(node.key));
    if (!node.isNew) {
      if (!window.confirm(`‘${nameOf(node)}’ ${KIND_LABELS[node.kind]}을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
      try {
        if (node.kind === "profile") await profileRequest({ remove: true, id: node.record.id, version: node.record.version });
        else await request("definitions/remove", {}, { id: node.record.id });
      } catch (error) {
        throw new Error(/referenced/i.test(error.message) ? "다른 정의나 Workflow가 이 정의를 쓰고 있어 삭제할 수 없습니다. 먼저 연결을 바꿔 저장하세요." : error.message);
      }
      defs = defs.filter(({ id }) => id !== node.record.id);
      profiles = profiles.filter(({ id }) => id !== node.record.id);
      if (node.kind === "profile") profilesChanged?.(profiles);
      notifyChanged?.();
    }
    for (const other of users) for (const [slot, value] of Object.entries(other.ref)) if (value === node.key) other.ref[slot] = "";
    nodes.delete(node.key);
    pinned.delete(node.key);
    delete spots()[node.key];
    saveLayout();
    render();
    say(`${nameOf(node)}을(를) 삭제했습니다.` + (users.length ? ` 연결 ${users.length}개를 해제했습니다.` : ""));
  }

  // ---- 툴바·불러오기 -------------------------------------------------------------
  function updateToolbar() {
    const count = dirtyCount();
    const save = el("save");
    save.textContent = count ? `변경 저장 (${count})` : "변경 저장";
    save.disabled = busy || !count;
    el("mode").hidden = !wf;
    for (const button of el("mode").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    el("workflow-name-field").hidden = !wf;
    el("check").disabled = !wf || !project;
    el("run").disabled = !wf?.record;
    workflowPicker.disabled = !project || !desktop();
    el("lanes").hidden = !wf;
    el("lane-workflow").style.left = WORKFLOW_X + "px";
    el("lane-line").style.left = (WORKFLOW_X - 50) + "px";
    paintExternalLane();
  }
  function paintExternalLane() {
    const host = el("surface");
    let lane = host.querySelector(":scope > .studio-lane-external");
    let line = host.querySelector(":scope > .studio-lane-external-line");
    if (!lane) {
      lane = h("div", { class: "studio-lane studio-lane-external" }, EXTERNAL_LANE_LABEL,
        h("small", {}, "Workflow 단계로 들어가지 않습니다"));
      line = h("div", { class: "studio-lane-line studio-lane-external-line" });
      host.prepend(line, lane);
    }
    const shown = visibleNodes().some(isEvaluationHarness);
    lane.hidden = !shown;
    line.hidden = !shown;
    lane.style.left = EXTERNAL_LANE_X + "px";
    line.style.left = (EXTERNAL_LANE_X + 340) + "px";
  }
  function fillWorkflowPicker(chosen) {
    workflowPicker.replaceChildren(h("option", { value: "" }, project ? "Workflow 열지 않음 · 정의만 보기" : "프로젝트를 고르면 Workflow를 열 수 있습니다"),
      ...(project ? [h("option", { value: "new" }, "+ 새 Workflow")] : []),
      // 템플릿 빠른 실행이 만든 자동 사본은 사용자가 저장한 Workflow 와 따로 묶는다.
      ...[["저장된 Workflow", false], ["빠른 실행 사본(자동 생성)", true]].map(([label, generated]) => {
        const items = workflows.filter((item) => Boolean(item.generated) === generated);
        return items.length ? h("optgroup", { label }, ...items.map((item) => h("option", { value: item.id }, engineeringWorkflowLabel(item)))) : null;
      }).filter(Boolean));
    workflowPicker.value = chosen ?? "";
    workflowPicker.dataset.value = workflowPicker.value;
  }
  async function loadWorkflows() {
    workflows = project && desktop() ? await request("workflows", { project: project.id }) : [];
  }
  async function load() {
    const owner = project?.id ?? "";
    catalogRequest ??= loadModelOptions(true).catch(() => loadModelOptions()).catch(() => {
      catalogRequest = null;
      return { engineering: [], claude: [], omp: [] };
    });
    const [records, profileList, models, flows] = await Promise.all([
      desktop() ? request("definitions", owner ? { project: owner } : { scope: "personal" }) : [],
      profileRequest().then(({ profiles }) => profiles).catch(() => []),
      catalogRequest,
      owner && desktop() ? request("workflows", { project: owner }) : [],
    ]);
    if (owner !== (project?.id ?? "")) return false;
    defs = records;
    profiles = profileList;
    catalog = { engineering: models.engineering ?? [], claude: models.claude ?? [], omp: models.omp ?? [] };
    ctx.catalog = catalog;
    workflows = flows;
    syncLibrary();
    loadedFor = owner;
    return true;
  }
  function mayReplace() {
    if (!dirtyCount()) return true;
    return window.confirm("노드 캔버스에 저장하지 않은 변경이 있습니다. 버리고 계속할까요?");
  }
  async function refresh({ keepView } = {}) {
    if (!(await load())) return;
    if (wf?.record && !workflowDirty()) {
      const latest = workflows.find(({ id }) => id === wf.record.id);
      if (latest && latest.version !== wf.record.version) {
        const record = await request("workflow", { project: project.id, id: latest.id });
        openDocument(record, record.payload);
      }
    }
    fillWorkflowPicker(wf ? wf.record?.id ?? "new" : "");
    render();
    if (!keepView) fit();
    if (!desktop()) say("정의와 Workflow는 데스크톱 앱에서만 읽고 쓸 수 있습니다. 지금은 에이전트 프로필만 보여 줍니다.");
  }
  function boxes(list) {
    return list.filter((node) => node.el && node.x !== undefined).map((node) => ({ x: node.x, y: node.y, width: node.el.offsetWidth, height: node.el.offsetHeight }));
  }
  // 자동 맞춤은 읽을 수 있는 배율(READABLE) 아래로 줄이지 않는다. Workflow 를 열었으면 단계와 단계에 직접 연결된 정의,
  // 그것도 안 되면 단계만 화면에 넣는다. full(전체 보기 버튼)은 배율과 관계없이 모두 넣는다.
  function fit({ full = false } = {}) {
    requestAnimationFrame(() => {
      const visible = visibleNodes();
      const stepNodes = visible.filter(({ kind }) => kind === "step");
      const direct = new Set(stepNodes.flatMap(({ ref }) => Object.values(ref)));
      const options = full ? {} : wf
        ? { min: READABLE.workflow, focus: [boxes(visible.filter((node) => node.kind === "step" || direct.has(node.key))), boxes(stepNodes)] }
        : { min: READABLE.library };
      if (!canvas.fit(boxes(visible), options)) canvas.fit([{ x: 0, y: 0, width: 800, height: 400 }]);
    });
  }
  // 왼쪽부터 모델 → 하네스 → 루프·프로필 → Workflow 순서로 다시 놓는다. 쓰는 쪽(오른쪽) 높이에 맞춰 줄을 세운다.
  function arrange() {
    placePending(visibleNodes().filter(({ kind, el: element }) => kind !== "step" && element));
    scheduleDraw();
    fit();
  }

  // 저장하지 않은 정의 변경을 버리고 저장된 값으로 다시 만든다(위치는 layout 에 남아 있다).
  function discardLibrary() {
    for (const node of libraryNodes()) if (isDirty(node)) nodes.delete(node.key);
    pinned.clear();
    syncLibrary();
  }
  async function addDefaults() {
    el("defaults").disabled = true;
    try {
      await request("workflows/presets/defaults", {}, { scope: "personal" });
      await refresh();
      say("기본 모델·하네스·루프·프로필을 개인 범위에 추가했습니다.", "ok");
      notifyChanged?.();
    } catch (error) {
      say(error.message, "error");
    } finally { el("defaults").disabled = false; }
  }

  // ---- 이벤트 -----------------------------------------------------------------
  workflowPicker.addEventListener("change", guard(async () => {
    const value = workflowPicker.value;
    if (!mayReplace()) { workflowPicker.value = workflowPicker.dataset.value ?? ""; return; }
    workflowPicker.dataset.value = value;
    discardLibrary();
    if (!value) openDocument(null, null);
    else if (value === "new") openDocument(null, blankDocument());
    else {
      const record = await request("workflow", { project: project.id, id: value });
      if (workflowPicker.value !== value) return;
      openDocument(record, record.payload);
    }
    applySpots();
    mode = "linked";
    render();
    fit();
    say(value === "new" ? "새 Workflow입니다. 빈 곳을 더블클릭해 단계를 추가하고 출력 소켓을 끌어 연결하세요." : "");
  }));
  workflowName.addEventListener("input", updateToolbar);
  for (const button of el("mode").querySelectorAll("button")) {
    button.addEventListener("click", () => { mode = button.dataset.mode; render(); fit(); });
  }
  el("add").addEventListener("click", (event) => {
    const box = viewport.getBoundingClientRect();
    openMenu(box.left + box.width / 2 - 140, box.top + 60, null);
    event.stopPropagation();
  });
  el("arrange").addEventListener("click", arrange);
  el("fit").addEventListener("click", () => fit({ full: true }));
  el("zoom-in").addEventListener("click", () => canvas.zoom(canvas.scale * 1.2));
  el("zoom-out").addEventListener("click", () => canvas.zoom(canvas.scale / 1.2));
  el("save").addEventListener("click", guard(saveAll));
  el("check").addEventListener("click", guard(async () => {
    const result = await request("workflows/plan", {}, { project: project.id, payload: serialize(true) });
    const names = new Map(result.document.nodes.map(({ id, label }) => [id, label]));
    say("검사 통과 · 실행 순서: " + result.order.map((id) => names.get(id) ?? id).join(" → "), "ok");
  }));
  el("run").addEventListener("click", () => {
    if (workflowDirty() && !window.confirm("저장하지 않은 Workflow 변경은 실행에 포함되지 않습니다. 저장된 버전으로 실행 화면을 열까요?")) return;
    openWorkflow(wf.record.id);
  });
  el("defaults").addEventListener("click", () => void addDefaults());
  el("defaults").hidden = !desktop();
  // Workflow ⋯ : 기본 Workflow 8종 추가, JSON 내보내기·가져오기(예전 Workflow 폼 화면의 기능).
  async function openSaved(id) {
    await loadWorkflows();
    fillWorkflowPicker(id);
    workflowPicker.dispatchEvent(new Event("change"));
    // 선택 변경 처리(비동기)가 끝나 그 Workflow 가 열릴 때까지 기다린다(그 처리가 상태 줄을 비우므로 뒤에 알린다).
    for (let index = 0; index < 60 && wf?.record?.id !== id; index++) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  function workflowMenu(event) {
    event.stopPropagation();
    const items = [
      ["기본 Workflow 8종 추가", async () => {
        if (!project) throw new Error("작업 프로젝트를 선택하세요.");
        const { created, skipped } = await request("workflows/presets/all", {}, { project: project.id });
        await loadWorkflows();
        fillWorkflowPicker(wf ? wf.record?.id ?? "new" : "");
        say(`기본 Workflow ${created.length}개를 추가했습니다.` + (skipped.length ? ` 이미 있는 ${skipped.length}개는 건너뛰었습니다.` : ""), "ok");
        notifyChanged?.();
      }],
    ];
    if (wf?.record) items.push(["이 Workflow를 JSON으로 내보내기", async () => {
      const template = await request("workflows/export", { project: project.id, id: wf.record.id, version: String(wf.record.version) });
      const resource = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
      const link = h("a", { href: resource, download: wf.record.name.replace(/[<>:"/\\|?*]/g, "-") + ".workflow.json" });
      link.click();
      setTimeout(() => URL.revokeObjectURL(resource), 1000);
    }]);
    items.push(["JSON에서 Workflow 가져오기…", () => {
      if (!project) throw new Error("작업 프로젝트를 선택하세요.");
      el("import-file").click();
    }]);
    const bounds = el("graph").getBoundingClientRect(), anchor = event.currentTarget.getBoundingClientRect();
    menuState = { at: canvas.center(), items: [] };
    menu.hidden = false;
    menu.style.left = Math.max(0, Math.min(anchor.left - bounds.left, bounds.width - 300)) + "px";
    menu.style.top = "8px";
    el("menu-title").textContent = "Workflow";
    menuSearch.hidden = true;
    menuList.replaceChildren(...items.map(([label, run]) => h("li", { role: "none" }, h("button", { type: "button", role: "menuitem",
      onclick: guard(async () => { closeMenu(); await run(); }) }, h("span", {}, label)))));
    menuList.querySelector("button")?.focus();
  }
  el("wf-more").addEventListener("click", workflowMenu);
  el("import-file").addEventListener("change", guard(async () => {
    const file = el("import-file").files[0];
    el("import-file").value = "";
    if (!file || !project) return;
    if (file.size > 60 * 1024) throw new Error("60KiB 이하의 Workflow 템플릿 JSON을 고르세요.");
    const template = JSON.parse(await file.text());
    // 같은 이름의 Workflow 가 있으면 '(가져옴)'을 붙여 새로 만든다.
    await loadWorkflows();
    const base = String(template?.payload?.name || file.name.replace(/(\.workflow)?\.json$/i, "")).slice(0, 200);
    const taken = new Set(workflows.map(({ name }) => name));
    let name = base, index = 1;
    while (taken.has(name)) name = base + " (가져옴" + (index++ > 1 ? " " + index : "") + ")";
    const record = await request("workflows/import", {}, { project: project.id, name, template });
    await openSaved(record.id);
    say(`Workflow ‘${record.name}’ v${record.version}을(를) 가져왔습니다.`, "ok");
  }));
  viewport.addEventListener("dblclick", (event) => {
    if (event.target.closest(".studio-node, g[data-link]")) return;
    openMenu(event.clientX, event.clientY, null);
  });
  viewport.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".studio-node")) return;
    event.preventDefault();
    openMenu(event.clientX, event.clientY, null);
  });
  // 선을 누르면 선택, 같은 선을 빨리 두 번 누르면 끊는다(선을 다시 그리면 SVG 요소가 바뀌어 dblclick 이 오지 않는다).
  let lastEdgeClick = { id: "", at: 0 };
  lines.addEventListener("pointerdown", (event) => {
    const group = event.target.closest("g[data-link]");
    if (!group) return;
    event.stopPropagation();
    event.preventDefault();
    const id = group.dataset.link;
    const now = performance.now();
    if (lastEdgeClick.id === id && now - lastEdgeClick.at < 450) {
      lastEdgeClick = { id: "", at: 0 };
      const item = links().find((entry) => entry.id === id);
      if (item) {
        removeLink(item);
        clearEdgeSelection();
        render();
        say("연결을 끊었습니다.");
      }
      return;
    }
    lastEdgeClick = { id, at: now };
    clearEdgeSelection();
    selectedEdge = id;
    selected = "";
    for (const item of layer.children) item.classList.remove("is-selected");
    const item = links().find((entry) => entry.id === id);
    if (item?.edge) inspectHandoff(item);
    say(item?.edge ? "실행 간선을 선택했습니다. 오른쪽에서 인계 스키마를 지정하거나 Delete로 끊으세요."
      : "연결을 선택했습니다. Delete로 끊거나, 한 번 더 눌러 바로 끊습니다.");
    viewport.focus({ preventScroll: true });
    scheduleDraw();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== el("add")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (!active) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      guard(saveAll)();
      return;
    }
    if (event.key === "Escape") { cancelLink(); closeMenu(); return; }
    if (!["Delete", "Backspace"].includes(event.key) || event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (!viewport.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (selectedEdge) {
      const item = links().find(({ id }) => id === selectedEdge);
      clearEdgeSelection();
      if (item) { event.preventDefault(); removeLink(item); render(); say("연결을 끊었습니다."); }
      return;
    }
    const node = nodes.get(selected);
    if (!node) return;
    event.preventDefault();
    if (node.kind === "step" && ["start", "end"].includes(node.data.type)) say("Start와 End는 지울 수 없습니다.");
    else if (node.kind === "step" || node.isNew) guard(() => removeNode(node))();
    else say("저장된 정의는 노드 메뉴(⋯)에서 삭제합니다.");
  });

  return {
    mayReplace,
    // 다른 화면(관제의 'Workflow 편집')에서 저장된 Workflow 를 열어 달라고 할 때 쓴다.
    async showWorkflow(id) {
      if (!project) return false;
      await loadWorkflows();
      if (!workflows.some((item) => item.id === id)) return false;
      fillWorkflowPicker(wf?.record?.id ?? "");
      workflowPicker.value = id;
      workflowPicker.dispatchEvent(new Event("change"));
      return true;
    },
    async activate() {
      active = true;
      if (loadedFor === (project?.id ?? "") && loadedFor !== null) {
        if (!dirtyCount()) await refresh({ keepView: true });
        else render();
        return;
      }
      await refresh();
    },
    deactivate() { active = false; cancelLink(); closeMenu(); },
    async selectProject(id, record) {
      const next = record ?? currentProject();
      if ((project?.id ?? "") === (id ?? "") && loadedFor !== null) { project = next; return; }
      project = id ? next : null;
      for (const node of libraryNodes()) nodes.delete(node.key);
      pinned.clear();
      openDocument(null, null);
      loadedFor = null;
      if (active) await refresh();
    },
    dirty: () => dirtyCount() > 0,
    projectId: () => project?.id ?? "",
    currentWorkflow: () => wf?.record ?? null,
    focusStep(id) {
      const node = stepById(id);
      if (!node) return false;
      focusNode(node);
      return true;
    },
  };
}
