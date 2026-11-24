/* 공통 카드 활성화·포커스·헤더 제어. 세션 수명과 화면 수명은 분리한다. */
let activeCardId = null;
let focusedCardId = null;

function activateCard(id) {
  if (!id) return;
  activeCardId = id;
  paintActiveCards();
}
function paintActiveCards() {
  for (const el of $("nodes").querySelectorAll(".node.big")) {
    el.classList.toggle("active-card", el.dataset.id === activeCardId);
    el.classList.toggle("focus-card", el.dataset.id === focusedCardId);
  }
  for (const row of document.querySelectorAll(".sl-row")) row.classList.toggle("active-card", row.dataset.id === activeCardId);
}
function cardClosed(id) {
  if (focusedCardId === id) focusedCardId = null;
  if (activeCardId === id) activeCardId = [...openIds].at(-1) || null;
  if (typeof clearParkedCard === "function") clearParkedCard(id);
}
function toggleCardFocus(id) {
  if (!openIds.has(id)) return;
  if (mapMode === "workspace" && activeCardId === id) {
    focusedCardId = null;
    setMapMode("map");
  } else {
    focusedCardId = id;
    activateCard(id);
    setMapMode("workspace");
  }
}
function cardWindowActions(id) {
  return `<button class="x" data-card-focus="1" title="카드 집중 보기 / 복원" aria-label="카드 집중 보기 또는 복원">⛶</button>
    <button class="x" data-card-menu="1" title="카드 메뉴" aria-label="카드 메뉴">⋯</button>
    <button class="x" data-close="1" title="카드 닫기 (세션 유지)" aria-label="카드 닫기">✕</button>`;
}
$("nodes").addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".node.big");
  if (el) activateCard(el.dataset.id);
}, true);
$("nodes").addEventListener("focusin", (e) => {
  const el = e.target.closest(".node.big");
  if (el) activateCard(el.dataset.id);
});
