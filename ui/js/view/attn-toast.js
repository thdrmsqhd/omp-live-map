/* omp-live-map · view · 미니맵 아래 세션 알림 toast(답변 완료·선택 필요) */

const ATTN_TOAST_MAX = 5;          // 세로로 쌓는 최대 개수(넘으면 오래된 것부터 뺀다)
const ATTN_TOAST_DONE_MS = 8000;   // 답변 완료는 몇 초 뒤 조용히 사라진다(카드 하이라이트는 유지)
const attnToastTimers = new Map(); // id → 자동 사라짐 타이머

// 알림 상자는 #app 안에 한 번만 만든다(미니맵과 같은 right 정렬).
function attnToastBox() {
  let box = $("attnToast");
  if (box) return box;
  box = document.createElement("div");
  box.id = "attnToast";
  $("app").appendChild(box);
  return box;
}

// 해당 id의 toast 와 타이머를 함께 없앤다.
function attnToastDrop(id) {
  clearTimeout(attnToastTimers.get(id));
  attnToastTimers.delete(id);
  const box = $("attnToast");
  const el = box && box.querySelector(`[data-attn="${CSS.escape(id)}"]`);
  if (el) el.remove();
}

// done 만 자동 사라짐을 건다. ask 는 사용자가 처리할 때까지 남는다.
function attnToastArm(id, kind) {
  clearTimeout(attnToastTimers.get(id));
  attnToastTimers.delete(id);
  if (kind !== "done") return;
  attnToastTimers.set(id, setTimeout(() => attnToastDrop(id), ATTN_TOAST_DONE_MS));
}

function attnToastShow(ev) {
  const { id, kind } = ev;
  const title = ev.title || "세션";
  const box = attnToastBox();
  attnToastDrop(id); // 같은 카드 재알림은 내용만 갱신하고 맨 아래로 옮긴다
  const el = document.createElement("div");
  el.className = "attn-toast " + (kind === "ask" ? "ask" : "done");
  el.dataset.attn = id;
  el.innerHTML = `<span class="ico">${kind === "ask" ? "?" : "✓"}</span>
    <span class="txt"><b>${kind === "ask" ? "선택 필요" : "답변 완료"}</b><span class="ttl">${esc(title)}</span></span>
    <button class="x" title="알림 닫기" aria-label="알림 닫기">✕</button>`;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".x")) { e.stopPropagation(); attnToastDrop(id); return; }
    attnToastDrop(id);
    if (typeof attnClear === "function") attnClear(id);    // 카드 하이라이트도 함께 해제
    if (typeof focusCard === "function") focusCard(id);    // 기존 포커스 함수 재사용
  });
  // 마우스를 올리는 동안에는 자동 사라짐을 멈춘다.
  el.addEventListener("mouseenter", () => {
    clearTimeout(attnToastTimers.get(id));
    attnToastTimers.delete(id);
  });
  el.addEventListener("mouseleave", () => attnToastArm(id, kind));
  box.appendChild(el);
  while (box.children.length > ATTN_TOAST_MAX) box.firstElementChild.remove();
  attnToastArm(id, kind);
}

// attention.js 가 보내는 set/clear 이벤트를 그대로 반영한다.
function onAttnEvent(ev) {
  if (!ev) return;
  if (ev.type === "clear") { attnToastDrop(ev.id); return; }
  if (ev.type === "set") attnToastShow(ev);
}

// attention.js 는 다른 작업자가 만든다. 아직 없으면 load 때 한 번 더 시도한다(없어도 화면은 정상).
function bindAttnToast() {
  if (typeof attnOn !== "function") return false;
  attnOn(onAttnEvent);
  return true;
}

if (!bindAttnToast()) addEventListener("load", bindAttnToast);
