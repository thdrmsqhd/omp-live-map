/* omp-live-map · viewmodel · 맵에서 띄운 세션의 실시간 활동(SSE live 이벤트) */

// node(기록 파일 경로) → 항목 배열. 키는 liveKey 로 맞춘다(구분자·대소문자 차이를 흡수).
const LIVE = new Map();
const LIVE_MAX = 200;        // node 당 보관 항목 수
const LIVE_TEXT_MAX = 8000;  // 글·생각 한 항목이 쥐는 글자 수(끝쪽을 남긴다)
const LIVE_DIRTY = new Set();
let liveSeq = 0;

const liveKey = (node) => String(node ?? "").replace(/\\/g, "/").toLowerCase();

function liveItems(node) {
  return LIVE.get(liveKey(node)) || [];
}

// 이벤트의 node 를 화면에 있는 카드 id 로 바꾼다. 카드가 없으면 "".
function liveNodeId(node) {
  if (ELS.has(node)) return node;
  const key = liveKey(node);
  for (const id of ELS.keys()) if (liveKey(id) === key) return id;
  return "";
}

// 글 조각이 몰려와도 한 프레임에 한 번, 바뀐 node 의 실시간 블록만 다시 그린다.
function liveTouch(node) {
  if (!LIVE_DIRTY.size) {
    requestAnimationFrame(() => {
      const nodes = [...LIVE_DIRTY];
      LIVE_DIRTY.clear();
      for (const k of nodes) {
        const id = liveNodeId(k);
        if (id && typeof paintChat === "function") paintChat(id);
      }
    });
  }
  LIVE_DIRTY.add(node);
}

function livePush(list, item) {
  item.seq = ++liveSeq;
  list.push(item);
  if (list.length > LIVE_MAX) list.splice(0, list.length - LIVE_MAX);
}

// 그 툴이 지금까지 낸 출력(끝쪽). 잡 카드·서브카드의 마지막 줄이 이걸 읽는다.
function liveOutText(node, toolCallId) {
  if (!toolCallId) return "";
  const list = liveItems(node);
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (it.kind === "tool" && it.id === toolCallId) return it.out || "";
  }
  return "";
}

// 턴 끝 신호를 받은 열린 서브 카드는 자동 닫기 검사를 예약한다. turn_end 는 완료 스냅샷보다 먼저 올 수 있다.
function scheduleSubDockCheck(node) {
  const id = liveNodeId(node);
  if (!id || !openIds.has(id)) return;
  const n = typeof nodeById === "function" ? nodeById(id) : null;
  if (!n || n.kind !== "sub") return;
  setTimeout(() => { if (openIds.has(id) && typeof renderMap === "function") renderMap(false); }, 500);
}

// SSE live 이벤트 {node, kind, id?, name?, args?, text?, status?, error?} 를 항목 배열에 반영한다.
function handleLiveEvent(ev) {
  if (!ev || !ev.node || !ev.kind) return;
  const key = liveKey(ev.node);
  let list = LIVE.get(key);
  if (!list) { list = []; LIVE.set(key, list); }
  const last = list[list.length - 1];
  const tool = () => { for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === "tool" && list[i].id === ev.id) return list[i]; };
  if (ev.kind === "text" || ev.kind === "think") {
    const add = String(ev.text ?? "");
    if (!add) return;
    if (last && last.kind === ev.kind) last.text = (last.text + add).slice(-LIVE_TEXT_MAX);
    else livePush(list, { kind: ev.kind, text: add.slice(-LIVE_TEXT_MAX) });
  } else if (ev.kind === "tool") {
    const item = { kind: "tool", id: ev.id, name: String(ev.name ?? ""), args: String(ev.args ?? ""), out: "", done: false, error: false };
    const end = list.findLastIndex((x) => x.kind === "turn_end");
    // 기록에서 읽힌 툴 시작은 확장의 turn_end 보다 늦게 도착할 수 있다(yield 로 끝나는 서브는 항상). 턴이 끝나기 전에 시작한 툴이면 끝난 턴 쪽에 끼워 "진행 중"으로 되살리지 않는다.
    if (end >= 0 && Number(ev.ts) > 0 && Number(ev.ts) <= list[end].ts) { item.done = true; item.seq = ++liveSeq; list.splice(end, 0, item); }
    else livePush(list, item);
  } else if (ev.kind === "out") {
    const t = tool();
    const out = String(ev.text ?? "");
    if (!t || t.out === out) return;
    t.out = out;
    // 백그라운드 잡으로 넘어간 툴의 출력은 잡 카드가 보여준다. 여기에는 한 줄만 남긴다.
    const bg = out.match(/Backgrounded[^]*?job (bg_\d+)/);
    if (bg) t.job = bg[1];
  } else if (ev.kind === "tool_job") {
    const t = tool();
    if (t) t.job = String(ev.job || "");
  } else if (ev.kind === "tool_end") {
    const t = tool();
    if (!t) return;
    t.done = true;
    t.error = !!ev.error;
  } else if (ev.kind === "sub") {
    livePush(list, { kind: "sub", name: String(ev.name ?? ""), status: String(ev.status ?? "") });
  } else if (ev.kind === "notify") {
    livePush(list, { kind: "notify", text: String(ev.text ?? "") });
  } else if (ev.kind === "turn_end") {
    // 턴이 끝났는데 닫히지 않은 툴은 더 돌지 않는 것으로 본다(백그라운드로 넘어간 출력은 계속 반영된다).
    for (const it of list) if (it.kind === "tool") it.done = true;
    livePush(list, { kind: "turn_end", ts: Number(ev.ts) || Date.now() });
    scheduleSubDockCheck(ev.node);
  } else return;
  liveTouch(ev.node);
}
