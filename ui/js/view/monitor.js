/* 관제/워크스페이스/맵 셸. 기존 열린 카드 상태 및 좌표는 모드 전환 때 보존한다. */
let mapMode = readJSON("omp-map-view-mode-v2", window.engineeringDesktop ? "map" : "overview");
if (!["map","overview","workspace"].includes(mapMode)) mapMode="map";
let overviewDensity = readJSON("omp-map-overview-density","standard");
if (!["compact","standard","detailed"].includes(overviewDensity)) overviewDensity="standard";
let overviewSort = readJSON("omp-map-overview-sort-v2","stable");
if (!["stable","attention","memory","recent","name"].includes(overviewSort)) overviewSort="stable";
let overviewMemory = Math.min(1048576,Math.max(128,Number(readJSON("omp-map-overview-memory",2048))||2048));
const OVERVIEW_SELECTED = new Set();
let renderWorkflowQueueMode;

function setMapMode(mode, render = true) {
  if (!["map","overview","workspace"].includes(mode)) return;
  stopMomentum();
  mapMode = mode;
  writeJSON("omp-map-view-mode-v2", mode);
  if (mode === "workspace" && !openIds.has(activeCardId)) activeCardId = [...openIds].at(-1) || null;
  paintMode();
  if (render) renderMap(false,true);
  if (mode === "overview" && typeof refreshMonitorProjects === "function") void refreshMonitorProjects();
}
function paintMode() {
  if (mapMode === "workspace" && !openIds.has(activeCardId)) activeCardId = [...openIds].at(-1) || null;
  $("app").dataset.view = mapMode;
  $("overview").hidden = mapMode !== "overview";
  $("workspace-empty").hidden = mapMode !== "workspace" || openIds.has(activeCardId);
  $("minimap").hidden = mapMode !== "map";
  for (const b of $("viewModes").querySelectorAll("button")) {
    const on = b.dataset.mode === mapMode;
    b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on));
  }
  paintActiveCards();
  if (renderWorkflowQueueMode) renderWorkflowQueueMode();
}
function paintMonitor(sessions) {
  paintMode();
  const res = $("globalResources");
  const next = SYS ? "CPU "+SYS.cpu.pct+"% · RAM "+SYS.mem.usedPct+"%" : "호스트 자원 미수집";
  if (res.textContent !== next) res.textContent = next;
  res.classList.toggle("resource-warning", !!SYS && SYS.mem.usedPct >= 85);
  if (mapMode === "overview" && typeof paintOverview === "function") paintOverview(sessions);
}
$("viewModes").addEventListener("click",(e)=> {
  const b=e.target.closest("[data-mode]");
  if (b) setMapMode(b.dataset.mode);
});
$("new-session-action").onclick=()=>{
  if (mapMode!=="map") setMapMode("map");
  const rect=$("stage").getBoundingClientRect();
  const pt=worldPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  openNewSession(pt);
};
$("overview-density").value=overviewDensity;
$("overview-sort").value=overviewSort;
$("overview-memory").value=overviewMemory;
$("overview-density").onchange=(e)=>{overviewDensity=e.target.value;writeJSON("omp-map-overview-density",overviewDensity);paintOverview(filteredSessions());};
$("overview-sort").onchange=(e)=>{overviewSort=e.target.value;writeJSON("omp-map-overview-sort-v2",overviewSort);paintOverview(filteredSessions());};
$("overview-memory").onchange=(e)=>{overviewMemory=Math.min(1048576,Math.max(128,Number(e.target.value)||2048));e.target.value=overviewMemory;writeJSON("omp-map-overview-memory",overviewMemory);paintOverview(filteredSessions());};
$("overview-select-all").onclick=()=>{
  const ids=monitorVisibleSessions(filteredSessions()).flatMap((s)=>s.nodes.filter((n)=>n.kind==="main").map((n)=>n.id));
  if(ids.every((id)=>OVERVIEW_SELECTED.has(id))) { for(const id of ids) OVERVIEW_SELECTED.delete(id); } else for(const id of ids) OVERVIEW_SELECTED.add(id);
  paintOverview(filteredSessions());
};
$("overview-close-selected").onclick=()=>{for(const id of [...OVERVIEW_SELECTED]) if(openIds.has(id))closeCard(id);renderMap(false,true);};
$("overview-pin-selected").onclick=()=>{for(const id of OVERVIEW_SELECTED){const key=sessionKeyOfNode(id);if(key){PINNED.add(key);HIDDEN.delete(key);}}savePinned();saveHidden();renderMap(false,true);};
paintMode();
