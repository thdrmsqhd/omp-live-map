// 노드 캔버스의 이동·확대. 빈 곳 드래그(또는 가운데 버튼)로 이동, 휠로 확대·축소한다.
// 노드 안의 textarea·목록처럼 스스로 스크롤되는 곳에서는 휠을 가로채지 않는다(Ctrl+휠은 항상 확대).
function bounds(boxes) {
  const left = Math.min(...boxes.map((box) => box.x)), top = Math.min(...boxes.map((box) => box.y));
  return { left, top, width: Math.max(...boxes.map((box) => box.x + box.width)) - left,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - top };
}

export function bindStudioCanvas({ viewport, surface, scaleOutput, onBackground, onChange }) {
  let scale = 1, x = 60, y = 60, pan;

  function paint() {
    surface.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    viewport.style.backgroundPosition = `${x}px ${y}px`;
    viewport.style.backgroundSize = `${24 * scale}px ${24 * scale}px`;
    if (scaleOutput) scaleOutput.textContent = Math.round(scale * 100) + "%";
    onChange?.();
  }

  function zoom(next, atX = viewport.clientWidth / 2, atY = viewport.clientHeight / 2) {
    const target = Math.min(2, Math.max(.15, next));
    x = atX - (atX - x) * target / scale;
    y = atY - (atY - y) * target / scale;
    scale = target;
    paint();
  }

  const background = (target) => target === viewport || target === surface || target.classList?.contains("studio-empty");
  function scrolls(target) {
    for (let item = target; item && item !== viewport; item = item.parentElement) {
      if (item.matches?.("textarea, .studio-menu-list") && item.scrollHeight > item.clientHeight) return true;
    }
    return false;
  }

  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey && scrolls(event.target)) return;
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    zoom(scale * Math.exp(-event.deltaY * .0016), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || pan) return;
    if (!(event.button === 1 || (event.button === 0 && background(event.target)))) return;
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    onBackground?.(event);
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

  return {
    zoom,
    get scale() { return scale; },
    // 화면 좌표 → 캔버스 좌표
    point(clientX, clientY) {
      const bounds = viewport.getBoundingClientRect();
      return { x: (clientX - bounds.left - x) / scale, y: (clientY - bounds.top - y) / scale };
    },
    center() {
      const bounds = viewport.getBoundingClientRect();
      return this.point(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    },
    // 주어진 사각형(캔버스 좌표)들이 모두 보이게 맞춘다.
    // min 을 주면 그보다 작게 줄이지 않는다. 그때 다 들어가지 않으면 focus 후보(앞쪽이 우선) 중 이 배율에
    // 들어가는 첫 묶음을 가운데에 두고, 어느 것도 들어가지 않으면 마지막 묶음의 왼쪽 위부터 보여 준다.
    fit(boxes, { min = .15, max = 1, focus = [] } = {}) {
      if (!boxes.length || !viewport.clientWidth || !viewport.clientHeight) return false;
      const width = viewport.clientWidth - 80, height = viewport.clientHeight - 80;
      const all = bounds(boxes);
      const fits = (box, k) => box.width * k <= width + 1 && box.height * k <= height + 1;
      scale = Math.min(2, Math.max(.15, Math.min(max, Math.max(min, Math.min(width / all.width, height / all.height)))));
      const sets = [all, ...focus.filter((list) => list.length).map(bounds)];
      const target = sets.find((box) => fits(box, scale));
      const box = target ?? sets.at(-1);
      x = target ? (viewport.clientWidth - box.width * scale) / 2 - box.left * scale : 40 - box.left * scale;
      y = target || box.height * scale <= height ? (viewport.clientHeight - box.height * scale) / 2 - box.top * scale : 40 - box.top * scale;
      paint();
      return true;
    },
    // 한 점이 보이도록만 이동(확대율 유지)
    reveal(box) {
      const right = (box.x + box.width) * scale + x, bottom = (box.y + box.height) * scale + y;
      const left = box.x * scale + x, top = box.y * scale + y;
      if (left >= 0 && top >= 0 && right <= viewport.clientWidth && bottom <= viewport.clientHeight) return;
      x = viewport.clientWidth / 2 - (box.x + box.width / 2) * scale;
      y = viewport.clientHeight / 2 - (box.y + box.height / 2) * scale;
      paint();
    },
    paint,
  };
}
