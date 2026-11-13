/* omp-live-map · view · 상단 필터·숨김 복원·줌 버튼·연결 상태 */

$("unhide").onclick = () => { HIDDEN.clear(); saveHidden(); renderMap(false, true); };
const doneSubsButton = $("doneSubs");
doneSubsButton.onclick = () => {
  HIDE_DONE_SUBS = !HIDE_DONE_SUBS;
  saveDoneSubs();
  renderMap(false, true);
};

function paintDoneSubsButton(hidden) {
  doneSubsButton.classList.toggle("on", hidden);
  doneSubsButton.textContent = hidden ? "완료 서브 숨김" : "완료 서브 표시";
  doneSubsButton.title = hidden
    ? "완료된 서브에이전트가 숨겨져 있습니다 · 클릭해서 표시"
    : "완료된 서브에이전트를 숨기려면 클릭";
}

$("zin").onclick = () => zoomTo(view.k * 1.25);

$("zout").onclick = () => zoomTo(view.k / 1.25);

$("zk").onclick = () => zoomTo(1);

$("zfit").onclick = fit;

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  FILTER = b.dataset.f;
  for (const x of $("filters").querySelectorAll("button")) x.classList.toggle("on", x === b);
  renderMap(true, true);
});

// 서버(SSE) 연결 상태. 끊기면 화면 값이 멈춘 것이므로 눈에 띄게 알린다.
function setConnected(on) {
  $("conn").hidden = on;
}
