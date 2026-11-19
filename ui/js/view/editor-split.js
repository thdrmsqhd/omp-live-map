/* omp-live-map · view · 대화(왼쪽)·편집기(오른쪽) 사이 경계 끌기. 비율은 모든 카드가 공유하고 localStorage 에 저장한다 */

let ED_COL = Math.max(25, Math.min(80, Number(localStorage.getItem("omp-map-edcol")) || 60));   // 편집기 열이 차지하는 % (본문 폭 기준, 기본 대화 4 : 편집기 6)

const edApplyCol = () => document.documentElement.style.setProperty("--edcol", ED_COL + "%");
edApplyCol();

$("stage").addEventListener("pointerdown", (e) => {
  const bar = e.target.closest(".edsplit");
  if (!bar) return;
  e.preventDefault();
  e.stopPropagation();
  const body = bar.parentElement;
  bar.setPointerCapture(e.pointerId);
  bar.classList.add("on");
  const move = (ev) => {
    const r = body.getBoundingClientRect();
    const side = body.querySelector(".col-tree");
    const right = r.right - (side ? side.offsetWidth + 10 : 0);   // 편집기 열의 오른쪽 끝(메모 열이 있으면 그 앞)
    const scale = r.width / body.offsetWidth || 1;                  // 지도 확대 배율 보정
    ED_COL = Math.max(25, Math.min(80, ((right - ev.clientX) / scale / body.offsetWidth) * 100));
    edApplyCol();
  };
  const up = () => {
    bar.classList.remove("on");
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", up);
    localStorage.setItem("omp-map-edcol", String(Math.round(ED_COL)));
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", up);
});

$("stage").addEventListener("dblclick", (e) => {
  if (!e.target.closest(".edsplit")) return;
  ED_COL = 60;
  localStorage.setItem("omp-map-edcol", "60");
  edApplyCol();
});
