/* omp-live-map · view · 위쪽 막대 한 줄: 시간 필터(저장·복원)·숨김 복원·완료 서브·연결 상태와 ⋯ 메뉴(배율·전체 보기·라이브러리·배치 되돌리기·단축키) */

const FILTER_KEY = "omp-map-filter";
const FILTERS = ["live", "2h", "24h", "all"];

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
}

// 시간 필터: 저장한 값이 있으면 그것, 없으면 24시간(state.js 기본값).
function paintFilters() {
  for (const x of $("filters").querySelectorAll("button")) x.classList.toggle("on", x.dataset.f === FILTER);
}
{
  const saved = readJSON(FILTER_KEY, null);
  if (FILTERS.includes(saved)) FILTER = saved;
  paintFilters();
}

// 첫 스냅샷 뒤 한 번: 고른 적이 없고 최근 24시간에 보일 세션이 없는데 그 전 기록이 있으면, 빈 벽 대신 전체 기간을 보여 준다(저장하지 않는다).
function topbarInitialFilter() {
  if (FILTERS.includes(readJSON(FILTER_KEY, null)) || FILTER !== "24h" || !(DATA.sessions || []).length || filteredSessions().length) return;
  FILTER = "all";
  paintFilters();
  umapToast("최근 24시간 활동이 없어 전체 기간을 보여 줍니다.");
}

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  FILTER = b.dataset.f;
  writeJSON(FILTER_KEY, FILTER);
  paintFilters();
  renderMap(true, true);
  // 보이는 세션이 바뀌었으니 벽을 다시 그리고 맨 위 100%로 둔다.
  if (typeof mapMode !== "undefined" && mapMode === "map") { paintUmap(true); umapFit(true); }
});

// ⋯: 덜 쓰는 조작을 한 메뉴에. 배율 항목은 맵에서만(세션 전체 화면에는 배율이 없다).
function topbarMenu(anchor) {
  const map = mapMode === "map";
  inlineMenu(anchor, [
    ...(map ? [
      { label: "확대 (+)", run: () => umapZoomTo(UM.view.k * 1.2) },
      { label: "축소 (−)", run: () => umapZoomTo(UM.view.k / 1.2) },
      { label: "100%로 (1) · 지금 " + Math.round(UM.view.k * 100) + "%", run: () => umapZoomTo(1) },
      { label: "벽 전체 보기 (0)", run: () => umapFit() },
      { label: "라이브러리 (Alt+L)", title: "하네스·루프·모델·Workflow 템플릿", run: () => (UMD.kind === "library" ? closeUmapDrawer() : openLibraryDrawer()) },
      { label: "자동 배치로 되돌리기", disabled: !umapHasManualLayout(), title: umapHasManualLayout() ? "옮긴 카드·타일 순서·타일 크기를 모두 자동으로(알림에서 되돌리기)" : "손으로 맞춘 배치가 없습니다",
        run: () => umapResetLayout() },
    ] : []),
    { label: HIDE_DONE_SUBS ? "완료 서브에이전트 표시" : "완료 서브에이전트 숨기기", run: () => doneSubsButton.click() },
    { label: "숨긴 세션 " + HIDDEN.size + "개 복원", disabled: !HIDDEN.size, run: () => $("unhide").click() },
    { label: "단축키와 조작 (?)", run: () => openHelpDrawer() },
  ]);
}
$("topbar-more").onclick = (event) => topbarMenu(event.currentTarget);

// 서버(SSE) 연결 상태. 끊기면 화면 값이 멈춘 것이므로 눈에 띄게 알린다.
function setConnected(on) {
  $("conn").hidden = on;
  for(const id of openIds)if(typeof paintChat==="function")paintChat(id);
}
