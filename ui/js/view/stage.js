/* omp-live-map · view · 화면 변환(팬·줌·모멘텀·fit) */

function applyView() {
  // 이동값이 소수 픽셀이면 글자가 픽셀 경계에 걸려 흐려지므로 정수로 맞춘다.
  $("wrapper").style.transform = `translate(${Math.round(view.x)}px,${Math.round(view.y)}px) scale(${view.k})`;
  $("zk").textContent = Math.round(view.k * 100) + "%";
  paintMinimap();
}

function stopMomentum() {
  if (velocity.raf) cancelAnimationFrame(velocity.raf);
  velocity = { x: 0, y: 0, t: 0, raf: 0 };
}

function momentum() {
  const step = () => {
    velocity.x *= 0.92;
    velocity.y *= 0.92;
    if (Math.abs(velocity.x) < 0.15 && Math.abs(velocity.y) < 0.15) { velocity.raf = 0; return; }
    view.x += velocity.x;
    view.y += velocity.y;
    applyView();
    velocity.raf = requestAnimationFrame(step);
  };
  velocity.raf = requestAnimationFrame(step);
}

function animateView(to, dur = 180) {
  // 보이지 않는 탭에서는 rAF 가 멈추므로 바로 적용한다.
  if (document.hidden) { Object.assign(view, to); applyView(); return; }
  const from = { ...view };
  let t0 = null;
  const tick = (t) => {
    if (t0 === null) t0 = t;   // rAF 시각과 performance.now() 는 기준이 어긋날 수 있어 첫 프레임 시각을 쓴다
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    view.k = from.k + (to.k - from.k) * e;
    view.x = from.x + (to.x - from.x) * e;
    view.y = from.y + (to.y - from.y) * e;
    applyView();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function zoomTo(k, cx, cy) {
  const rect = $("stage").getBoundingClientRect();
  const px = (cx == null ? rect.width / 2 : cx - rect.left);
  const py = (cy == null ? rect.height / 2 : cy - rect.top);
  const kk = Math.min(2.6, Math.max(0.12, k));
  const nx = px - (px - view.x) * (kk / view.k);
  const ny = py - (py - view.y) * (kk / view.k);
  animateView({ x: nx, y: ny, k: kk }, 140);
}

// 맵 좌표의 사각형 하나가 화면 가운데에 꽉 차도록 이동한다.
function fitBox(box, pad, dur, kMin = 0.22, kMax = 1.4) {
  const stage = $("stage").getBoundingClientRect();
  const k = Math.min(kMax, Math.max(kMin, Math.min((stage.width - pad * 2) / Math.max(1, box.w), (stage.height - pad * 2) / Math.max(1, box.h))));
  animateView({
    k,
    x: pad + ((stage.width - pad * 2) - box.w * k) / 2 - box.x * k,
    y: pad + ((stage.height - pad * 2) - box.h * k) / 2 - box.y * k,
  }, dur);
}

function boundsOf(boxes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

const allBoxes = () => [...geo.values(), ...CLUSTERS, ...SATS.values()];

function fit() {
  const b = boundsOf(allBoxes());
  if (b) fitBox(b, 30, 200, 0.18, 1.6);
}

function focusSession(key) {
  const c = CLUSTERS.find((x) => x.key === key);
  if (c) fitBox(c, 26, 220);
}

function worldPoint(clientX, clientY) {
  const r = $("stage").getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
}
