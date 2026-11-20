/* omp-live-map · viewmodel · 주의가 필요한 세션(답변 완료 · 선택 필요) 상태 */

// nodeId -> { kind: "done"|"ask", title, ts }. 같은 카드에 둘이 겹치면 ask 가 이긴다.
const ATTN = new Map();

const ATTN_SUBS = [];          // 상태 변화 구독자(toast 등)
const ATTN_SEEN = new Map();   // nodeId -> 직전 관찰값 { busy, ask }. 첫 관찰 때 이미 끝난 세션은 알리지 않는다.
const ATTN_ACK = new Map();    // nodeId -> 사용자가 카드를 열어 확인한 질문 id 집합(같은 질문으로 다시 알리지 않는다)
const ATTN_SCAN_MS = 600;

// 구독. 돌려준 함수를 부르면 해지된다.
function attnOn(fn) {
  ATTN_SUBS.push(fn);
  return () => {
    const i = ATTN_SUBS.indexOf(fn);
    if (i >= 0) ATTN_SUBS.splice(i, 1);
  };
}

function attnEmit(ev) {
  for (const fn of [...ATTN_SUBS]) {
    try { fn(ev); } catch (e) { console.error("attn", e); }
  }
}

// 카드 클래스·미니맵 점은 view 가 칠한다(아직 로드 전이면 다음 렌더가 맞춘다).
function attnPaintNow() {
  if (typeof paintAttention === "function") paintAttention();
}

function attnClear(id) {
  const cur = ATTN.get(id);
  if (!cur) return;
  // 사용자가 카드를 열어 본 질문은 그 질문이 풀리거나 새 질문이 올 때까지 다시 알리지 않는다.
  if (cur.kind === "ask" && typeof asksOf === "function") ATTN_ACK.set(id, new Set(asksOf(id).map((r) => String(r.id))));
  ATTN.delete(id);
  attnPaintNow();
  attnEmit({ type: "clear", id, kind: cur.kind, title: cur.title });
}

function attnSet(id, kind, title) {
  const cur = ATTN.get(id);
  const t = title || "";
  if (cur && cur.kind === kind && cur.title === t) return;
  ATTN.set(id, { kind, title: t, ts: Date.now() });
  attnPaintNow();
  attnEmit({ type: "set", id, kind, title: t });
}

// toast 에서 어느 세션인지 알아보도록 세션 제목을 먼저 쓴다(메인 카드 이름은 대개 "main").
const attnTitle = (n) => String(n.sessionTitle || "").trim() || displayName(n) || n.title || String(n.id);

// 메인 자신이 응답 생성 중인가: 이 탭이 띄운 rpc 세션(chatState.busy)이거나, 실시간 활동의 마지막 턴이 아직 안 닫힌 상태.
function attnMainBusy(id) {
  const st = CHAT.get(id);
  if (st && st.busy) return true;
  if (typeof actItems !== "function") return false;
  try { return actItems(id).running; } catch { return false; }
}

// 이 세션이 띄운 서브(하위 서브 포함)가 아직 도는 개수. 판정은 sub-dock 의 subRunning 을 그대로 쓴다.
// 끝을 알 수 없는 서브(kill 등)는 서버가 90초 뒤 idle 로 바꾸고 subRunning 이 실행 중으로 보지 않으므로 영원히 기다리지 않는다.
function attnSubsRunning(id) {
  return typeof runningSubsOf === "function" ? runningSubsOf(id).length : 0;
}

// 끝난 것으로 알리려면 메인도 쉬고 서브도 모두 끝나야 한다. 메인이 턴을 끝내도 서브가 돌면 아직 진행 중이다.
const attnBusy = (id) => attnMainBusy(id) || attnSubsRunning(id) > 0;

// 맵에 있는 메인 세션 카드를 600ms 마다 훑어 busy→끝남·질문 등장 전이를 잡는다.
// 서브에이전트 카드까지 알리면 노이즈가 커서 메인 세션만 대상으로 한다.
function attnScan() {
  if (!Array.isArray(NODES) || !NODES.length) return;
  const seen = new Set();
  for (const n of NODES) {
    if (n.kind !== "main") continue;
    const id = n.id;
    seen.add(id);
    const ask = typeof askPending === "function" ? askPending(id) : false;
    const busy = attnBusy(id);
    const prev = ATTN_SEEN.get(id) || { busy: false, ask: false };
    if (ask) {
      // 확인한 질문뿐이면 다시 울리지 않는다. 새 질문이 오면 그때 알린다.
      const ack = ATTN_ACK.get(id);
      const fresh = !ack || asksOf(id).some((r) => !ack.has(String(r.id)));
      if (fresh) attnSet(id, "ask", attnTitle(n));
      else if (ATTN.has(id)) attnClear(id);              // 확인한 질문만 남았으면 표시를 걷는다
    } else {
      ATTN_ACK.delete(id);
      const cur = ATTN.get(id);
      if (cur && cur.kind === "ask") attnClear(id);       // 답을 보냈거나 시한이 지나 질문이 풀렸다
      if (busy) { if (ATTN.has(id)) attnClear(id); }      // 다시 도는 중이면 해제
      else if (prev.busy) attnSet(id, "done", attnTitle(n)); // 생성 중 → 끝남
    }
    ATTN_SEEN.set(id, { busy, ask });
  }
  // 필터로 빠진 카드는 관찰값을 버려, 다시 나타날 때 옛 busy 가 done 으로 오인되지 않게 한다.
  for (const id of [...ATTN_SEEN.keys()]) if (!seen.has(id)) ATTN_SEEN.delete(id);
}

let ATTN_TIMER = 0;

function attnStart() {
  if (ATTN_TIMER) return;
  attnScan();
  ATTN_TIMER = setInterval(attnScan, ATTN_SCAN_MS);
}

attnStart();
