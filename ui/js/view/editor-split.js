/* 카드별 채팅·편집기 비율. 기존 전역 값은 신규 카드의 초기값으로만 사용한다. */
const DEFAULT_ED_COL = Math.max(25, Math.min(80, Number(localStorage.getItem("omp-map-edcol")) || 60));
const cardSplit = (id) => cardUI(id).split ?? DEFAULT_ED_COL;
let cancelEditorSplit = null;
$("stage").addEventListener("pointerdown", (e) => {
  const bar = e.target.closest(".edsplit"), card = bar?.closest(".node.big");
  if (!card || e.button !== 0 || spaceDown) return;
  e.preventDefault(); e.stopPropagation();
  const id = card.dataset.id, body = bar.parentElement;
  const start = cardSplit(id);
  let value = start;
  bar.classList.add("on");
  runBlockGesture(e, bar, (ev) => {
    const r = body.getBoundingClientRect(), side = body.querySelector(".col-tree");
    const right = r.right - (side ? side.getBoundingClientRect().width : 0);
    value = Math.round(Math.max(25, Math.min(80, (right - ev.clientX) / Math.max(1, r.width) * 100)));
    card.style.setProperty("--edcol", value + "%");
  }, () => {
    bar.classList.remove("on");
    if (value === start) return;
    pushHistory(layoutSnapshot({ ui: [id] }));
    cardUI(id).split = value; saveCardUI();
  }, () => { bar.classList.remove("on"); card.style.setProperty("--edcol", start + "%"); });
});
$("stage").addEventListener("dblclick", (e) => {
  const card = e.target.closest(".edsplit")?.closest(".node.big");
  if (!card) return;
  pushHistory(layoutSnapshot({ ui: [card.dataset.id] }));
  cardUI(card.dataset.id).split = DEFAULT_ED_COL;
  saveCardUI(); renderMap(false, true);
});
