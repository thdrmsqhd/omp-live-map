/* omp-live-map · view · 카드 블록 레지스트리 (slot: main | side) */
//
// 카드 = 블록 목록. 새 블록은 view/block-*.js 에서 registerBlock 으로 등록하고,
// BLOCK_DEFAULTS 나 CARD_BLOCKS(nodeId) 오버라이드에 넣으면 큰 카드 바디에 붙는다.
//
//   render(n)       블록 안쪽 마크업(문자열). 큰 카드 바디를 새로 만들 때만 불린다.
//   mount(box, n)   바디가 새로 생긴 직후 1회. 리스너 배선과 첫 스크롤 위치.
//   paint(box, n)   바디 DOM 을 유지한 채 스냅샷이 바뀌었을 때. 바뀐 부분만 갱신한다.
//   onAdd(nodeId)   (선택) 블록 메뉴로 카드에 더해 다시 그린 직후 1회. 카드 크기 맞추기 등.
//
// 블록 접기·순서·높이는 CARD_UI(nodeId) 에 저장한다(조작 배선: block-controls.js).

const BLOCKS = new Map();

function registerBlock(def) {
  if (!def || !def.type || typeof def.render !== "function") throw new Error("block needs type + render");
  BLOCKS.set(def.type, def);
}

// 잡은 스테이지 잡 카드가 보여주므로 bg 블록은 기본으로 넣지 않는다(블록 메뉴에서 더할 수 있다).
const BLOCK_DEFAULTS = (n) => (agentKind(n.kind) ? ["chat", "terminal", "files"]
  : n.kind === "local" ? ["terminal", "files"] : ["terminal"]);

function cardBlockTypes(n) {
  const base = BLOCK_DEFAULTS(n);
  const ov = CARD_BLOCKS.get(n.id);
  // 배열은 예전 전체 덮어쓰기 형식, 객체는 기본값 대비 {add, remove} 차이만 저장한다.
  const list = Array.isArray(ov)
    ? ov
    : ov
      ? [...base.filter((t) => !(ov.remove || []).includes(t)), ...(ov.add || [])]
      : base;
  // 상태가 nodeId 로 키잉되므로 같은 타입 블록은 카드당 1개만 허용한다.
  // 저장된 설정에 남은 옛 타입(예: "live")은 등록된 블록만 남겨 조용히 버린다.
  return [...new Set(list)].filter((t) => BLOCKS.has(t));
}

const BLOCK_H_MIN = 80, BLOCK_H_MAX = 1080;

function cardUI(nodeId) {
  let u = CARD_UI.get(nodeId);
  if (!u) { u = { collapsed: {}, order: { main: [], side: [] }, h: {} }; CARD_UI.set(nodeId, u); }
  return u;
}

// 한 슬롯에 그릴 블록 정의를 저장된 순서대로 돌려준다. 순서에 없는 블록은 기본 순서대로 뒤에 붙는다.
function slotBlocks(n, slot) {
  const ui = CARD_UI.get(n.id);
  const order = (ui && ui.order[slot]) || [];
  const rank = (t, i) => { const k = order.indexOf(t); return k >= 0 ? k : order.length + i; };
  return cardBlockTypes(n)
    .map((t) => BLOCKS.get(t))
    .filter((b) => b && b.slot === slot)
    .map((b, i) => ({ b, r: rank(b.type, i) }))
    .sort((a, z) => a.r - z.r)
    .map(({ b }) => b);
}

function renderBlocks(n, slot) {
  const ui = CARD_UI.get(n.id);
  return slotBlocks(n, slot).map((b) => blockShell(n, b, ui)).join("");
}

// 바디의 블록 구성 서명. 같으면 바디 DOM 을 다시 만들지 않는다.
function blockSig(n) {
  const ui = CARD_UI.get(n.id);
  const one = (b) => b.type + (ui && ui.collapsed[b.type] ? "-" : "") + ((ui && ui.h[b.type]) || "");
  return ["main", "side"].map((slot) => slotBlocks(n, slot).map(one).join(",")).join("|");
}

function blockShell(n, b, ui) {
  const t = esc(b.type);
  const collapsed = !!(ui && ui.collapsed[b.type]);
  const h = ui && ui.h[b.type];
  const style = collapsed ? "flex:0 0 auto" : h ? `flex:0 0 auto;height:${h}px` : `flex:${b.flex ?? 1}`;
  const cls = "blk" + (collapsed ? " collapsed" : h ? " sized" : "");
  return `<div class="${cls}" data-blk="${t}" data-slot="${esc(b.slot)}" style="${style}">
    <div class="bctl"><button class="bgrip" data-bgrip="${t}" title="끌어서 순서 변경">⋮⋮</button><button class="bchev" data-bchev="${t}" title="${collapsed ? "펼치기" : "접기"}">${collapsed ? "▸" : "▾"}</button></div>
    ${b.render(n)}
    <button class="bresize" data-bresize="${t}" title="끌어서 높이 조절 · 더블클릭으로 원래대로"></button>
  </div>`;
}

// renderMap 이 열린 카드마다 부른다. 새 블록은 mount, 유지된 블록은 paint.
function mountBlocks(n, el) {
  if (!n || !el) return;
  for (const box of el.querySelectorAll(":scope > .body .blk[data-blk]")) {
    const b = BLOCKS.get(box.dataset.blk);
    if (!b) continue;
    if (!box.dataset.mounted) {
      box.dataset.mounted = "1";
      if (b.mount) b.mount(box, n);
    } else if (b.paint) b.paint(box, n);
  }
}

function toggleBlock(nodeId, type) {
  const node = nodeById(nodeId);
  if (!node) return;
  const cur = cardBlockTypes(node).slice();
  const i = cur.indexOf(type);
  if (i >= 0) {
    if (cur.length <= 1) return;   // 카드에 블록이 하나도 없으면 안 된다.
    cur.splice(i, 1);
  } else cur.push(type);
  const base = BLOCK_DEFAULTS(node);
  CARD_BLOCKS.set(nodeId, { add: cur.filter((t) => !base.includes(t)), remove: base.filter((t) => !cur.includes(t)) });
  saveBlocks();
  renderMap(false, true);
  const def = BLOCKS.get(type);
  if (i < 0 && def && def.onAdd) def.onAdd(nodeId);
}
