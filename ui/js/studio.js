// 노드 캔버스: 모델 → 하네스 → 루프 → Workflow 단계, 에이전트 프로필 → Agent 를 한 캔버스에서 연결해 엔지니어링한다.
// 저장 형식은 기존 화면과 같다(정의 API·프로필 API·Workflow API). 이 화면만의 상태는 노드 위치(localStorage)뿐이다.
import { bindStudioCanvas } from "./studio-canvas.js";
import { bindStudioInspect } from "./studio-inspect.js";
import { bindStudioLayout } from "./studio-layout.js";
import { bindStudioDrag } from "./studio-drag.js";
import { bindStudioMenu } from "./studio-menu.js";
import { bindStudioPersist } from "./studio-persist.js";
import { bindStudioHistory } from "./studio-history.js";
import { loadModelOptions } from "./engineering-model-options.js";
import {
  h, KIND_LABELS, STEP_TYPES, STEP_HINTS, SCOPE_LABELS, HARNESS_TEMPLATES, HARNESS_CATALOG,
  socketsOf, widgetsOf, problemsOf, blankPayload, blankStep, harnessTypeOf,
  harnessContractDetails, isEvaluationHarness, isEvaluationRole, evaluationFlowBlock, socketDragAllowed,
  EXTERNAL_LANE_X, EXTERNAL_LANE_LABEL,
} from "./studio-nodes.js";

import { PORT_NAMES, READABLE, SX, SY, TYPE_LABELS, WORKFLOW_X, blankDocument, clamp, readLayout } from "./studio-shared.js";

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
    const prefix = node.kind === "profile" ? (owner?.scope === "team" ? "[팀 · " + owner.team + "] " : "") : "[" + (owner.scope === "team" ? "팀 · " + owner.team : SCOPE_LABELS[owner.scope]) + "] ";
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
    editHistory?.clear();
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
    scopeChoices, desktop,
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
    const scope = node.kind === "profile" ? (owner?.scope === "team" ? "팀 " + owner.team + " · " : "") : (owner.scope === "team" ? "팀 " + owner.team : SCOPE_LABELS[owner.scope]) + " · ";
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
    el("undo").disabled = !editHistory?.canUndo();
    el("redo").disabled = !editHistory?.canRedo();
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

  // ---- 나눈 모듈 연결 ----------------------------------------------------------
  const S = {
    historyClear: () => editHistory?.clear(),
    loadWorkflows, fillWorkflowPicker, notifyChanged, request,
    get busy() { return busy; }, set busy(value) { busy = value; },
    get defs() { return defs; }, set defs(value) { defs = value; },
    get layout() { return layout; }, set layout(value) { layout = value; },
    get link() { return link; }, set link(value) { link = value; },
    get mode() { return mode; }, set mode(value) { mode = value; },
    get profiles() { return profiles; }, set profiles(value) { profiles = value; },
    get project() { return project; }, set project(value) { project = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get selectedEdge() { return selectedEdge; }, set selectedEdge(value) { selectedEdge = value; },
    get wf() { return wf; }, set wf(value) { wf = value; },
    get workflows() { return workflows; }, set workflows(value) { workflows = value; },
    addDefaults,
    canvas,
    closure,
    connectEnds,
    createLibrary,
    createStep,
    desktop,
    el,
    fillWorkflowPicker,
    fingerprint,
    firstSocket,
    guard,
    idOf,
    inspect,
    isDirty,
    labelOf,
    layer,
    libraryNode,
    libraryNodes,
    links,
    loadWorkflows,
    menu,
    menuList,
    menuSearch,
    nameOf,
    nodes,
    openDocument,
    get openMenu() { return openMenu; },
    ownerFor,
    ownerOf,
    pinned,
    place,
    profilesChanged,
    reinspect,
    get remember() { return remember; },
    removeLink,
    get removeNode() { return removeNode; },
    render,
    get revert() { return revert; },
    get saveLayout() { return saveLayout; },
    say,
    scheduleDraw,
    get select() { return select; },
    serialize,
    socket,
    get spots() { return spots; },
    stepById,
    steps,
    updateToolbar,
    viewport,
    visibleNodes,
    workflowDirty,
    workflowName,
  };
  const { applySpots, clearEdgeSelection, collapsedByDefault, inspectHandoff, linkedProfile, placeGrid, placePending, remember, saveLayout, select, spots, toggleCollapse } = bindStudioLayout(S);
  const { cancelLink, finishLink, startLink, startMove } = bindStudioDrag(S);
  const { closeMenu, menuItems, nodeMenu, openMenu, paintMenu, pick, workflowMenu } = bindStudioMenu(S);
  const { payloadOf, profileRequest, rekey, removeNode, revert, saveAll, saveNode, saveWorkflow } = bindStudioPersist(S);
  // 되돌리기 이력. openDocument·updateToolbar 가 먼저 불릴 수 있어 var 로 선언 전 접근을 허용한다(그때는 undefined).
  var editHistory = bindStudioHistory(S);

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
  // 되돌리기 이력: 캔버스·메뉴에서 조작이 시작될 때 찍고, 끝난 뒤 달라졌으면 남긴다.
  const graph = el("graph");
  graph.addEventListener("pointerdown", () => editHistory.begin(), true);
  graph.addEventListener("focusin", () => editHistory.begin(), true);
  for (const type of ["pointerup", "change", "focusout"]) graph.addEventListener(type, () => setTimeout(() => { editHistory.commit(); updateToolbar(); }), true);
  graph.addEventListener("click", () => setTimeout(() => { editHistory.commit(); updateToolbar(); }));
  el("undo").addEventListener("click", () => editHistory.undo());
  el("redo").addEventListener("click", () => editHistory.redo());
  document.addEventListener("keydown", (event) => {
    if (!active) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      guard(saveAll)();
      return;
    }
    if (event.key === "Escape") { cancelLink(); closeMenu(); return; }
    // 입력칸 안에서는 브라우저의 글자 되돌리기를 그대로 둔다.
    const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
    if ((event.ctrlKey || event.metaKey) && !typing && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.key.toLowerCase() === "y" || event.shiftKey) editHistory.redo(); else editHistory.undo();
      return;
    }
    // 고른 노드를 방향키로 옮긴다(8px, Shift 와 함께 40px). 마우스 없이도 배치할 수 있다.
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key] && !typing && viewport.contains(document.activeElement)) {
      const node = nodes.get(selected);
      if (!node || node.x === undefined) return;
      event.preventDefault();
      editHistory.begin();
      const distance = event.shiftKey ? 40 : 8, [dx, dy] = arrows[event.key];
      node.x = Math.max(0, node.x + dx * distance);
      node.y = Math.max(0, node.y + dy * distance);
      place(node);
      remember(node);
      saveLayout();
      scheduleDraw();
      editHistory.commit();
      updateToolbar();
      return;
    }
    if (!["Delete", "Backspace"].includes(event.key) || typing) return;
    editHistory.begin();
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
    // 캔버스 밖에서 정의·Workflow 를 만들었을 때(첫 실행 안내) 같은 프로젝트를 다시 읽는다.
    async reload() { if (active) await refresh({ keepView: true }); },
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
