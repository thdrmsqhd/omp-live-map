/* omp-live-map · view · 클러스터 선택과 묶음(제목) 이동: 대상 엘리먼트·이력 키·저장 좌표 이동 */

const clusterKeyOf = (c) => c.kind + ":" + (c.key ?? c.kind);

const clusterByKey = (key) => CLUSTERS.find((c) => clusterKeyOf(c) === key) || null;

// 수동 배치(MANUAL) 키: 세션은 세션 키, HOST·인프라는 종류 이름.
const manualKeyOf = (c) => (c.kind === "session" ? c.key : c.kind);

const frameOf = (c) => $("nodes").querySelector(`.cluster[data-ckey="${CSS.escape(clusterKeyOf(c))}"]`);

function paintSelection() {
  for (const el of $("nodes").querySelectorAll(".cluster[data-ckey]")) el.classList.toggle("sel", SELECTED.has(el.dataset.ckey));
}

function selectOnly(c) {
  SELECTED.clear();
  if (c) SELECTED.add(clusterKeyOf(c));
  paintSelection();
}

const itemOf = (el) => ({ el, css: el.style.cssText, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 });

// 선택된 클러스터에 딸린 엘리먼트(프레임·작은 카드·미러·열린 큰 카드·HOST 지표)를 모은다.
function clusterItems(list) {
  const box = $("nodes"), items = [];
  const add = (el) => { if (el) items.push(itemOf(el)); };
  for (const c of list) {
    add(frameOf(c));
    for (const id of c.members || []) {
      if (openIds.has(id)) add(box.querySelector(`.node[data-ghost="${CSS.escape(id)}"]`));
      add(ELS.get(id));
    }
    if (c.kind === "host") box.querySelectorAll(".node[data-metric]").forEach(add);
  }
  return items;
}

// 이력에 담을 키: 원점·카드 저장 좌표(숨긴 구성원 포함)·열린 큰 카드·로컬 카드.
function clusterKeys(list) {
  const keys = { manual: [], big: [], locals: [] };
  for (const c of list) {
    if (c.kind === "local") { keys.locals.push(c.key); continue; }
    keys.manual.push(manualKeyOf(c));
    for (const id of c.allIds || c.members || []) {
      if (MANUAL[cardManualKeyOf(id)]) keys.manual.push(cardManualKeyOf(id));
      if (openIds.has(id) && BIGPOS.has(id)) keys.big.push(id);
    }
  }
  return keys;
}

function moveClusters(list, dx, dy) {
  for (const c of list) {
    shiftCluster(c, dx, dy);
    for (const id of c.allIds || c.members || []) {
      const saved = MANUAL[cardManualKeyOf(id)];
      if (saved) MANUAL[cardManualKeyOf(id)] = { x: saved.x + dx, y: saved.y + dy };
      const b = openIds.has(id) && BIGPOS.get(id);
      if (b) BIGPOS.set(id, { ...b, x: b.x + dx, y: b.y + dy });
    }
    if (c.kind === "local") {
      const L = LOCALS.find((l) => l.id === c.key);
      if (L) { L.x = c.x + 16; L.y = c.y + 62; }
    } else MANUAL[manualKeyOf(c)] = c.kind === "session" ? { x: c.ox, y: c.oy } : { x: c.x, y: c.y };
  }
}
