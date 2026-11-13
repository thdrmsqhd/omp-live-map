/* omp-live-map · view · 큰 카드 열기·닫기·자동 배치와 공용 표시 도우미 */

function openNode(id) {
  if (openIds.has(id)) closeCard(id);
  else {
    openIds.add(id);
    saveOpenCards();
  }
  renderMap(false, true);
  if (!openIds.has(id)) return;
  focusCluster(id);
  loadBg(id);
}

// 열린 카드의 클러스터와 큰 카드가 한 화면에 들어오게 맞춘다.
function focusCluster(nodeId) {
  const c = clusterOfCard(nodeId) || geo.get(nodeId);
  const b = boundsOf([c, SATS.get(nodeId)].filter(Boolean));
  if (b) fitBox(b, 24, 180);
}

// 카드 하나를 화면 가운데로 가져와 잠깐 강조한다(세션 컨텍스트 목록에서 이동).
function focusCard(id) {
  const g = geo.get(id);
  if (!g) return;
  const st = $("stage").getBoundingClientRect();
  const k = Math.max(view.k, 0.7);
  animateView({ k, x: st.width / 2 - (g.x + g.w / 2) * k, y: st.height / 2 - (g.y + g.h / 2) * k }, 200);
  const sel = `.node[data-id="${CSS.escape(id)}"]:not(.big), .node[data-ghost="${CSS.escape(id)}"]`;
  const el = $("nodes").querySelector(sel);
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;   // 같은 카드를 연달아 눌러도 애니메이션이 다시 돈다
  el.classList.add("flash");
}

// 큰 카드를 처음 열 때의 자리: 클러스터 오른쪽, 다른 카드와 겹치지 않는 곳.
function placeSatellite(anchor) {
  const obstacles = [...CLUSTERS, ...geo.values(), ...SATS.values()];
  const box = { x: anchor.x + anchor.w + 80, y: anchor.y, w: BIG_W, h: BIG_H };
  for (let i = 0; i < 400; i++) {
    if (!obstacles.some((r) => rectsOverlap(box, r))) break;
    box.y += 26;
  }
  return box;
}

// 엘리먼트 글자를 잠시 바꿨다가 되돌린다(복사됨 표시 등).
function flashText(el, text, ms = 1200) {
  if (!el) return;
  if (!el.dataset.flash) el.dataset.orig = el.textContent;
  el.dataset.flash = "1";
  el.textContent = text;
  clearTimeout(el.__flashT);
  el.__flashT = setTimeout(() => {
    el.textContent = el.dataset.orig || "";
    delete el.dataset.flash;
    delete el.dataset.orig;
  }, ms);
}

function copyText(text, el) {
  if (!navigator.clipboard) { flashText(el, "복사 실패"); return; }
  navigator.clipboard.writeText(String(text ?? "")).then(() => flashText(el, "복사됨"), () => flashText(el, "복사 실패"));
}
