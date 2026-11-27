// 노드 캔버스(studio.js)에서 나눈 모듈: 자동 배치·접힘·선택(노드 위치는 localStorage).
// studio.js 의 상태·함수는 S 로 받는다. let 상태(wf·project 등)는 S 의 getter·setter 로 읽고 쓴다.
import { h, isEvaluationHarness, EXTERNAL_LANE_X } from "./studio-nodes.js";
import { COLUMN, GAP, KIND_ORDER, LAYOUT_KEY } from "./studio-shared.js";
export function bindStudioLayout(S) {
  const { el, inspect, layer, libraryNodes, nameOf, nodes, say, stepById, steps } = S;
  const closure = (...args) => S.closure(...args);
  const place = (...args) => S.place(...args);
  const render = (...args) => S.render(...args);
  const scheduleDraw = (...args) => S.scheduleDraw(...args);
  const updateToolbar = (...args) => S.updateToolbar(...args);
  const visibleNodes = (...args) => S.visibleNodes(...args);
  function placePending(list = visibleNodes().filter((node) => node.el && node.kind !== "step" && node.x === undefined)) {
    if (!list.length) return;
    const pending = new Set(list);
    for (const node of list) { node.x = undefined; node.y = undefined; }
    const anchor = (node) => {
      const users = [...nodes.values()].filter((other) => other.el && other.y !== undefined && Object.values(other.ref).includes(node.key));
      return users.length ? Math.min(...users.map(({ y }) => y)) : Infinity;
    };
    const external = list.filter((node) => isEvaluationHarness(node));
    for (const kinds of [["loop"], ["harness"], ["model"]]) {
      const column = list.filter((node) => kinds.includes(node.kind) && !external.includes(node));
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
    saveLayout();
  }
  // 정의 노드 위치는 보는 맥락(Workflow별, 또는 Workflow 없이 정의만)마다 따로 기억한다.
  function spots() {
    const context = S.wf ? "wf:" + (S.wf.record?.id ?? "new") : "library";
    S.layout.contexts ??= {};
    return S.layout.contexts[context] ??= {};
  }
  function applySpots() {
    const table = spots(), linked = S.wf ? closure() : null;
    for (const node of libraryNodes()) {
      const spot = table[node.key];
      Object.assign(node, { x: spot?.x, y: spot?.y, collapsed: spot ? Boolean(spot.c) : collapsedByDefault(node, linked) });
    }
  }
  // 처음 보는 정의 노드의 접힘 상태. 정의만 볼 때는 모두 접어 목록처럼 훑어 보게 하고,
  // Workflow 를 열었을 때는 그 Workflow 에 연결되지 않은 정의('전체 정의'에서만 보임)만 접는다(연결된 정의는 바로 고칠 수 있게 펼친다).
  function collapsedByDefault(node, linked = S.wf ? closure() : null) {
    if (node.isNew) return false;
    return !linked || !linked.has(node.key);
  }
  function remember(node) {
    if (node.kind === "step") {
      S.layout.steps ??= {};
      if (node.collapsed) S.layout.steps[node.data.id] = 1; else delete S.layout.steps[node.data.id];
    } else if (node.x !== undefined) spots()[node.key] = { x: Math.round(node.x), y: Math.round(node.y), c: node.collapsed ? 1 : 0 };
  }
  function saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(S.layout)); } catch { /* 저장 공간이 없으면 위치만 잃는다 */ }
  }
  function toggleCollapse(node) {
    node.collapsed = !node.collapsed;
    remember(node);
    saveLayout();
    render();
  }
  function clearEdgeSelection() {
    S.selectedEdge = "";
    if (el("inspect").querySelector("[data-handoff-editor]")) inspect.close();
  }
  function select(key) {
    S.selected = key;
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

  return { applySpots, clearEdgeSelection, collapsedByDefault, inspectHandoff, placePending, remember, saveLayout, select, spots, toggleCollapse };
}
