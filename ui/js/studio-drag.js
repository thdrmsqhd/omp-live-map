// 노드 캔버스(studio.js)에서 나눈 모듈: 끌기: 노드 이동·소켓 연결.
// studio.js 의 상태·함수는 S 로 받는다. let 상태(wf·project 등)는 S 의 getter·setter 로 읽고 쓴다.
import { isEvaluationHarness, EXTERNAL_LANE_X } from "./studio-nodes.js";
import { TYPE_LABELS, WORKFLOW_X } from "./studio-shared.js";
export function bindStudioDrag(S) {
  const { canvas, nameOf, nodes, say, viewport } = S;
  const connectEnds = (...args) => S.connectEnds(...args);
  const firstSocket = (...args) => S.firstSocket(...args);
  const links = (...args) => S.links(...args);
  const openMenu = (...args) => S.openMenu(...args);
  const place = (...args) => S.place(...args);
  const remember = (...args) => S.remember(...args);
  const removeLink = (...args) => S.removeLink(...args);
  const render = (...args) => S.render(...args);
  const saveLayout = (...args) => S.saveLayout(...args);
  const scheduleDraw = (...args) => S.scheduleDraw(...args);
  const socket = (...args) => S.socket(...args);
  const updateToolbar = (...args) => S.updateToolbar(...args);
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
    if (S.link) { finishLink(event); return; }
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
    S.link = { origin, point: canvas.point(event.clientX, event.clientY), startX: event.clientX, startY: event.clientY };
    viewport.classList.add("is-linking");
    viewport.dataset.linking = type;
    if (isEvaluationHarness(nodes.get(origin.key)) && origin.dir === "out") viewport.dataset.linkOrigin = "evaluation";
    else if (node.kind === "step" && type === "harness") viewport.dataset.linkOrigin = "step";
    else delete viewport.dataset.linkOrigin;
    const move = (moveEvent) => { S.link.point = canvas.point(moveEvent.clientX, moveEvent.clientY); scheduleDraw(); };
    const up = (upEvent) => {
      const still = Math.abs(upEvent.clientX - S.link.startX) < 4 && Math.abs(upEvent.clientY - S.link.startY) < 4;
      if (still) {
        // 클릭만 했으면 다음 클릭 위치에 연결한다.
        say(`${TYPE_LABELS[type]} 연결 중 · 연결할 소켓이나 노드를 누르세요. Esc로 취소`);
        const next = (downEvent) => { downEvent.stopPropagation(); downEvent.preventDefault(); finishLink(downEvent); };
        window.addEventListener("pointerdown", next, { once: true, capture: true });
        const previous = S.link.cleanup;
        S.link.cleanup = () => { previous(); window.removeEventListener("pointerdown", next, true); };
        return;
      }
      finishLink(upEvent);
    };
    S.link.cleanup = () => { window.removeEventListener("pointermove", move); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    scheduleDraw();
  }
  function cancelLink() {
    if (!S.link) return;
    S.link.cleanup?.();
    S.link = null;
    viewport.classList.remove("is-linking");
    delete viewport.dataset.linking;
    delete viewport.dataset.linkOrigin;
    scheduleDraw();
  }
  function finishLink(event) {
    const current = S.link;
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

  return { cancelLink, finishLink, startLink, startMove };
}
