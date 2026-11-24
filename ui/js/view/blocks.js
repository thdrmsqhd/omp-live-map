/* omp-live-map · view · 카드 블록 레지스트리 (slot: main | side | edit) */
//
// 카드 = 블록 목록. 새 블록은 view/block-*.js 에서 registerBlock 으로 등록하고,
// BLOCK_DEFAULTS 나 CARD_BLOCKS(nodeId) 오버라이드에 넣으면 큰 카드 바디에 붙는다.
//
//   render(n, key)  블록 안쪽 마크업(문자열). 큰 카드 바디를 새로 만들 때만 불린다.
//   mount(box, n)   바디가 새로 생긴 직후 1회. 리스너 배선과 첫 스크롤 위치(인스턴스 키: box.dataset.bkey).
//   paint(box, n)   바디 DOM 을 유지한 채 스냅샷이 바뀌었을 때. 바뀐 부분만 갱신한다.
//   onAdd(nodeId, key)   (선택) 블록 메뉴로 카드에 더해 다시 그린 직후 1회. 카드 크기 맞추기 등.
//   onRemove(nodeId, key) (선택) 블록 메뉴로 카드에서 뺀 직후, 다시 그리기 전에 1회. onAdd 가 키운 크기 되돌리기 등.
//
// 블록 접기·순서·높이는 CARD_UI(nodeId) 에 저장한다(조작 배선: block-controls.js).
//
// 블록 키는 타입이고, 같은 타입을 두 번 붙이는 블록은 두 번째부터 "browser#2" 처럼 인스턴스 키를 쓴다.
// 상태·순서·높이는 인스턴스 키로 저장하고, 정의 조회는 기본 타입(blockBase)으로 한다.

const BLOCKS = new Map();
const BLOCK_FOCUS = new Map();
const BLOCK_TITLES = { chat: "채팅", context: "컨텍스트", terminal: "터미널", bg: "백그라운드 잡", editor: "코드 편집기", browser: "브라우저", db: "DB 조회", memo: "메모" };
const BLOCK_SLOTS = { main: "중앙", edit: "오른쪽", side: "보조", left: "왼쪽" };

// 카드당 허용 인스턴스 수. 여기 없는 타입은 1개.
const BLOCK_MAX = { browser: 2 };

const blockBase = (key) => String(key).split("#")[0];
const blockMax = (key) => BLOCK_MAX[blockBase(key)] || 1;
const blockInstances = (list, base) => list.filter((k) => blockBase(k) === base);

function registerBlock(def) {
  if (!def || !def.type || typeof def.render !== "function") throw new Error("block needs type + render");
  BLOCKS.set(def.type, def);
}

// 잡은 스테이지 잡 카드가 보여주므로 bg 블록은 기본으로 넣지 않는다(블록 메뉴에서 더할 수 있다).
// 서브에이전트 카드는 chat 만 기본: 터미널 등은 블록 메뉴로 직접 더한다.
// editor 블록(VS Code형: 탐색기+탭+Monaco)이 파일 트리를 대신한다. 서브에이전트 카드에는 넣지 않는다.
const BLOCK_DEFAULTS = (n) => (n.kind === "sub" ? ["chat"]
  : n.kind === "main" ? ["editor", "chat", "terminal"]
  : n.kind === "local" ? ["editor", "terminal"] : ["terminal"]);

function cardBlockTypes(n) {
  const base = BLOCK_DEFAULTS(n);
  const ov = CARD_BLOCKS.get(n.id);
  // 배열은 예전 전체 덮어쓰기 형식, 객체는 기본값 대비 {add, remove} 차이만 저장한다.
  // 옛 저장값 이전: "files" 블록은 editor(탐색기)로 합친다. 전체 덮어쓰기 배열에 editor 가 없으면(editor 도입 전 저장) 첫 자리에 더한다.
  const mig = (l) => l.map((t) => (t === "files" ? "editor" : t));
  let list = base;
  if (Array.isArray(ov)) {
    list = mig(ov);
    if (base.includes("editor") && !list.includes("editor")) list.unshift("editor");
  } else if (ov) {
    list = [...base.filter((t) => !(ov.remove || []).filter((x) => x !== "files").includes(t)), ...mig(ov.add || [])];
  }
  if (n.kind === "sub") list = list.filter((t) => t !== "editor");   // 저장된 sub 카드 구성에 남은 editor/files 는 버린다
  // 같은 키는 한 번만, 같은 타입은 blockMax(기본 1)개까지만 허용한다.
  // 저장된 설정에 남은 옛 타입(예: "live")은 등록된 블록만 남겨 조용히 버린다.
  const out = [];
  const count = {};
  for (const key of list) {
    const base = blockBase(key);
    if (!BLOCKS.has(base) || out.includes(key)) continue;
    if ((count[base] = (count[base] || 0) + 1) > blockMax(base)) continue;
    out.push(key);
  }
  return out;
}

function cardUI(nodeId) {
  let u = CARD_UI.get(nodeId);
  if (!u) { u = { collapsed: {}, order: { main: [], side: [], edit: [], left: [] }, h: {}, fit: {} }; CARD_UI.set(nodeId, u); }
  if (!u.fit) u.fit = {};
  if (!u.slots) u.slots = {};
  for (const slot of Object.keys(BLOCK_SLOTS)) if (!Array.isArray(u.order[slot])) u.order[slot]=[];
  return u;
}

// 한 슬롯에 그릴 블록을 저장된 순서대로 돌려준다. 순서에 없는 블록은 기본 순서대로 뒤에 붙는다.
// 반환: [{ b: 정의, key: 인스턴스 키 }]
// 블록이 실제로 놓이는 슬롯. 편집기는 대화(chat)가 있는 카드에서만 대화 오른쪽 열(edit)에 놓이고, 없으면 main 에 쌓인다.
const slotOf = (n, b, key = b.type) => {
  const override = CARD_UI.get(n.id)?.slots?.[key];
  if (Object.hasOwn(BLOCK_SLOTS, override)) return override;
  const hasChat = cardBlockTypes(n).includes("chat");
  return b.type === "editor" && hasChat ? "edit" : b.type === "browser" && hasChat ? "left" : b.slot;
};

function slotBlocks(n, slot) {
  const ui = CARD_UI.get(n.id);
  const order = (ui && ui.order[slot]) || [];
  const rank = (t, i) => { const k = order.indexOf(t); return k >= 0 ? k : order.length + i; };
  return cardBlockTypes(n)
    .map((key) => ({ b: BLOCKS.get(blockBase(key)), key }))
    .filter((x) => x.b && slotOf(n, x.b, x.key) === slot)
    .map((x, i) => ({ ...x, r: rank(x.key, i) }))
    .sort((a, z) => a.r - z.r)
    .map(({ b, key }) => ({ b, key }));
}

function renderBlocks(n, slot) {
  const ui = CARD_UI.get(n.id);
  return slotBlocks(n, slot).map(({ b, key }) => blockShell(n, b, key, ui)).join("");
}

// 바디의 블록 구성 서명. 같으면 바디 DOM 을 다시 만들지 않는다.
function blockSig(n) {
  const ui = CARD_UI.get(n.id);
  const one = (key) => key + (ui && ui.collapsed[key] ? "-" : "") + ((ui && ui.h[key]) || "");
  return ["main", "edit", "side", "left"].map((slot) => slotBlocks(n, slot).map((x) => one(x.key)).join(",")).join("|");
}

function blockShell(n, b, key, ui) {
  const base = esc(b.type);
  const k = esc(key);
  const collapsed = !!(ui && ui.collapsed[key]);
  const h = ui && ui.h[key];
  const style = collapsed ? "flex:0 0 auto" : h ? `flex:0 0 auto;height:${h}px` : `flex:${b.flex ?? 1}`;
  const cls = "blk" + (collapsed ? " collapsed" : h ? " sized" : "");
  const slot = slotOf(n, b, key);
  const name = (BLOCK_TITLES[b.type] || b.type) + (key.includes("#") ? " " + key.split("#")[1] : "");
  const options = Object.entries(BLOCK_SLOTS).map(([v, label]) => `<option value="${v}"${slot === v ? " selected" : ""}>${label}</option>`).join("");
  return `<div class="${cls}" data-blk="${base}" data-bkey="${k}" data-slot="${esc(slot)}" style="${style}">
    <div class="bheader"><button class="bgrip" data-bgrip="${k}" title="블록 이동" aria-label="블록 이동">⋮⋮</button><strong>${esc(name)}</strong>
      <div class="bctl"><select data-bslot="${k}" aria-label="블록 배치">${options}</select>
      <button data-bmax="${k}" title="집중 보기 / 복원" aria-label="블록 집중 보기">⛶</button>
      <button class="bchev" data-bchev="${k}" title="${collapsed ? "펼치기" : "접기"}" aria-label="${collapsed ? "펼치기" : "접기"}" aria-expanded="${!collapsed}">${collapsed ? "▸" : "▾"}</button>
      <button data-bremove="${k}" title="블록 제거" aria-label="블록 제거"${cardBlockTypes(n).length <= 1 ? " disabled" : ""}>✕</button></div>
    </div>
    ${b.render(n, key)}
    <button class="bresize" data-bresize="${k}" title="끌어서 높이 조절 · 더블클릭으로 원래대로" aria-label="블록 높이 조절"></button>
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

// key: 인스턴스 키("browser", "browser#2" …). 있으면 빼고 없으면 더한다.
function toggleBlock(nodeId, key) {
  const node = nodeById(nodeId);
  if (!node) return;
  const cur = cardBlockTypes(node).slice();
  const i = cur.indexOf(key);
  if (i >= 0) {
    if (cur.length <= 1) return;   // 카드에 블록이 하나도 없으면 안 된다.
    cur.splice(i, 1);
  } else {
    if (blockInstances(cur, blockBase(key)).length >= blockMax(key)) return;
    cur.push(key);
  }
  const base = BLOCK_DEFAULTS(node);
  CARD_BLOCKS.set(nodeId, { add: cur.filter((t) => !base.includes(t)), remove: base.filter((t) => !cur.includes(t)) });
  saveBlocks();
  const def = BLOCKS.get(blockBase(key));
  if (i >= 0 && BLOCK_FOCUS.get(nodeId) === key) BLOCK_FOCUS.delete(nodeId);
  if (i >= 0 && def && def.onRemove) def.onRemove(nodeId, key);
  renderMap(false, true);
  if (i < 0 && def && def.onAdd) def.onAdd(nodeId, key);
}

function paintBlockFocus(card) {
  const body = card.querySelector(":scope > .body");
  if (!body) return;
  const selected = BLOCK_FOCUS.get(card.dataset.id);
  const blocks = [...body.querySelectorAll(".blk[data-bkey]")];
  const valid = selected && blocks.some((b) => b.dataset.bkey === selected);
  body.classList.toggle("has-block-focus", !!valid);
  for (const b of blocks) {
    b.classList.toggle("block-focused", !!valid && b.dataset.bkey === selected);
    b.querySelector("[data-bmax]")?.setAttribute("aria-pressed", String(!!valid && b.dataset.bkey === selected));
  }
}
