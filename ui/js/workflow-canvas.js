export const nodeWidth = 132;
export const nodeHeight = 90;

export function bindWorkflowCanvas(el, cancelConnection) {
  const viewport = el("viewport"), surface = el("surface");
  let scale = 1, x = 0, y = 0;
  let pan;

  function paint() {
    surface.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    viewport.style.backgroundPosition = `${x}px ${y}px`;
    viewport.style.backgroundSize = `${20 * scale}px ${20 * scale}px`;
    el("scale").textContent = Math.round(scale * 100) + "%";
  }

  function zoom(next, atX = viewport.clientWidth / 2, atY = viewport.clientHeight / 2) {
    const target = Math.min(2.5, Math.max(.025, next));
    x = atX - (atX - x) * target / scale;
    y = atY - (atY - y) * target / scale;
    scale = target;
    paint();
  }

  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    zoom(scale * Math.exp(-event.deltaY * .003), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || pan || (event.button !== 1 &&
        (event.button !== 0 || event.target.closest(".workflow-node")))) return;
    event.preventDefault();
    cancelConnection();
    pan = { id: event.pointerId, x: event.clientX - x, y: event.clientY - y };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (pan?.id !== event.pointerId) return;
    x = event.clientX - pan.x;
    y = event.clientY - pan.y;
    paint();
  });
  viewport.addEventListener("lostpointercapture", (event) => {
    if (pan?.id !== event.pointerId) return;
    pan = null;
    viewport.classList.remove("is-panning");
  });
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancelConnection();
    if (event.target !== viewport) return;
    const offset = { ArrowLeft: [36, 0], ArrowRight: [-36, 0], ArrowUp: [0, 36], ArrowDown: [0, -36] }[event.key];
    if (!offset) return;
    event.preventDefault();
    x += offset[0];
    y += offset[1];
    paint();
  });
  el("zoom-in").onclick = () => zoom(scale * 1.2);
  el("zoom-out").onclick = () => zoom(scale / 1.2);

  return {
    point(clientX, clientY) {
      const bounds = viewport.getBoundingClientRect();
      return { x: (clientX - bounds.left - x) / scale, y: (clientY - bounds.top - y) / scale };
    },
    fit(nodes) {
      if (!nodes.length || !viewport.clientWidth || !viewport.clientHeight) return false;
      const left = Math.min(...nodes.map((node) => node.x));
      const top = Math.min(...nodes.map((node) => node.y));
      const width = Math.max(...nodes.map((node) => node.x)) + nodeWidth - left;
      const height = Math.max(...nodes.map((node) => node.y)) + nodeHeight - top;
      scale = Math.min(1, Math.max(1, viewport.clientWidth - 72) / width,
        Math.max(1, viewport.clientHeight - 72) / height);
      x = (viewport.clientWidth - width * scale) / 2 - left * scale;
      y = (viewport.clientHeight - height * scale) / 2 - top * scale;
      paint();
      return true;
    },
  };
}
