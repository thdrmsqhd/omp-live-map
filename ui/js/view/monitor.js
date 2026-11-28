/* omp-live-map · view · 한 화면 셸. 모드는 둘이다.
   - map: 관제 벽(#umap: 프로젝트 타일 격자, 타일 안은 Task > Workflow 단계 > 세션). 기본 화면. 프로젝트 하나 전체 화면은 모드가 아니라 UM.focus.
   - workspace: 세션 하나의 전체 화면(#stage 의 큰 카드). 맵의 세션 카드를 두 번 누르거나 '열기'로 들어가고 Esc·'맵으로'로 같은 자리에 돌아온다.
   열린 카드 상태와 맵 위치는 모드를 바꿔도 그대로다. */

function setMapMode(mode, render = true) {
  if (!["map", "workspace"].includes(mode)) return;
  stopMomentum();
  const previous = mapMode;
  mapMode = mode;
  writeJSON("omp-map-view-mode-v3", mode);
  if (mode === "workspace" && !openIds.has(activeCardId)) activeCardId = [...openIds].at(-1) || null;
  paintMode();
  if (render) renderMap(false, true);
  if (mode === "map" && previous !== "map") {
    if (UM.returnTo) { UM.view = UM.returnTo; UM.returnTo = null; }
    paintUmap(true);
  }
}
function paintMode() {
  if (mapMode === "workspace" && !openIds.has(activeCardId)) activeCardId = [...openIds].at(-1) || null;
  $("app").dataset.view = mapMode;
  $("umap").hidden = mapMode !== "map";
  $("back-to-map").hidden = mapMode !== "workspace";
  $("workspace-empty").hidden = mapMode !== "workspace" || openIds.has(activeCardId);
  if (paintMode.last !== mapMode) { paintMode.last = mapMode; document.dispatchEvent(new CustomEvent("omp-mode", { detail: mapMode })); }
  paintActiveCards();
}
function paintMonitor() {
  paintMode();
  if (mapMode === "map") paintUmapSoon();
  else paintUmapResources();
}
$("new-session-action").onclick = () => {
  const rect = $("stage").getBoundingClientRect();
  openNewSession(worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
};
paintMode();
