/* omp-live-map · view · 위쪽 막대(한 줄): ＋ Task · ● omp · claude · 개입 필요 N · 자원 한 줄('CPU 45% · RAM 80% · WSL ● · Docker ○') · 맵으로.
   자원 한 줄을 누르면 오른쪽 서랍에 HOST·WSL·Docker 상세와 기존 인프라 조작(부팅·종료·compose up·start/stop/restart)이 열린다. */

function umapResourceLine() {
  const distros = INFRA.distros || [], containers = INFRA.containers || [];
  const wsl = distros.length ? (distros.some((d) => String(d.state).toLowerCase() === "running") ? "●" : "○") : "–";
  const docker = containers.length ? (containers.some((c) => c.state === "running") ? "●" : "○") : "○";
  return (SYS ? `CPU ${SYS.cpu.pct}% · RAM ${SYS.mem.usedPct}%` : "CPU – · RAM –") + ` · WSL ${wsl} · Docker ${docker}`;
}
function paintUmapResources() {
  const button = $("umap-resources");
  if (!button) return;
  const text = umapResourceLine();
  if (button.textContent !== text) button.textContent = text;
  button.classList.toggle("resource-warning", Boolean(SYS && SYS.mem.usedPct >= 85));
  if (UMD.kind === "resources" && !$("umap-drawer").contains(document.activeElement)) paintResourcesBody();
}
function paintUmapTopbar(bands) {
  const list = umapAttention(bands);
  const button = $("umap-attention");
  button.hidden = false;
  button.textContent = "개입 필요 " + list.length;
  button.classList.toggle("has-items", list.length > 0);
  button.title = list.length ? list.slice(0, 8).map(({ label }) => label).join("\n") + "\n(Alt+I: 다음 항목으로 이동)" : "개입이 필요한 항목이 없습니다";
  paintUmapResources();
}

function resourceBar(label, value, pct, sub) {
  const level = pct > 85 ? "err" : pct > 65 ? "warn" : "ok";
  return `<div class="um-res"><div><b>${esc(label)}</b><span>${esc(value)}</span></div><div class="ibar ${level}"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></div><small>${esc(sub)}</small></div>`;
}
function paintResourcesBody() {
  const body = $("umap-drawer-body");
  const gb = (mb) => (mb / 1024).toFixed(1);
  const host = SYS ? [resourceBar("CPU", SYS.cpu.pct + "%", SYS.cpu.pct, SYS.cpu.cores + " cores"),
    resourceBar("RAM", `${gb(SYS.mem.usedMB)} / ${gb(SYS.mem.totalMB)} GB`, SYS.mem.usedPct, `여유 ${gb(SYS.mem.freeMB)} GB`),
    SYS.disk ? resourceBar("DISK C:", SYS.disk.freeGB + " GB free", SYS.disk.usedPct, `사용 ${SYS.disk.usedPct}% / ${SYS.disk.totalGB} GB`) : "",
    `<p class="um-muted">가동 ${Math.floor(SYS.uptimeSec / 3600)}시간 ${Math.floor((SYS.uptimeSec % 3600) / 60)}분</p>`].join("") : `<p class="um-muted">호스트 자원을 아직 받지 못했습니다.</p>`;
  const nodes = infraNodes();
  const row = (n, extra = "") => `<li class="um-infra ${esc(n.status)}"><i class="dot ${esc(n.status)}"></i><b>${esc(n.name)}</b><small>${esc([n.meta1, n.meta2].filter(Boolean).join(" · "))}${extra}</small><span class="um-spacer"></span>${infraActions(n, true)}</li>`;
  const distros = nodes.filter((n) => n.kind === "distro");
  const projects = nodes.filter((n) => n.kind === "project");
  const docker = projects.map((p) => row(p) + nodes.filter((n) => n.kind === "container" && n.parent === p.id).map((c) => row(c, c.ports ? " · " + c.ports : "")).join("")).join("");
  const memory = Math.min(1048576, Math.max(128, Number(readJSON("omp-map-overview-memory", 2048)) || 2048));
  body.innerHTML = `<section class="um-dsec"><h3>HOST · 이 PC</h3>${host}</section>
    <section class="um-dsec"><h3>WSL</h3>${distros.length ? `<ul class="um-dlist">${distros.map((n) => row(n)).join("")}</ul>` : `<p class="um-muted">${esc(INFRA.error || "WSL 배포판이 없습니다.")}</p>`}</section>
    <section class="um-dsec"><h3>Docker</h3>${docker ? `<ul class="um-dlist">${docker}</ul>` : `<p class="um-muted">${distros.some((d) => d.status === "live") ? "컨테이너가 없습니다." : "WSL 이 꺼져 있어 컨테이너를 볼 수 없습니다."}</p>`}</section>
    <section class="um-dsec"><h3>설정</h3>
      <label class="um-check"><input type="checkbox" data-res="power"${powerSave ? " checked" : ""}> 절전 · 화면 밖 세션 카드의 무거운 블록 해제</label>
      <label class="um-check"><input type="checkbox" data-res="frames"${suspendFrames ? " checked" : ""}> 비활성 브라우저 해제(다시 열 때 재로드)</label>
      <label class="um-field"><span>세션 RAM 경고(MB)</span><input type="number" data-res="memory" min="128" max="1048576" step="128" value="${memory}"></label></section>`;
}
function openResourcesDrawer() {
  openUmapDrawer("resources", "resources", "자원 · HOST · WSL · Docker", []);
  paintResourcesBody();
}
function bindUmapTopbar() {
  $("umap-resources").onclick = () => (UMD.kind === "resources" ? closeUmapDrawer() : openResourcesDrawer());
  $("umap-attention").onclick = umapJumpAttention;
  $("workflow-new-run").onclick = () => { if (mapMode !== "map") setMapMode("map"); umapOpenAdd(undefined, { run: true }); };
  $("back-to-map").onclick = () => setMapMode("map");
  $("umap-drawer-close").onclick = closeUmapDrawer;
  const body = $("umap-drawer-body");
  body.addEventListener("click", (event) => {
    const act = event.target.closest("button[data-act]");
    if (!act || UMD.kind !== "resources") return;
    const kind = act.dataset.act, target = act.dataset.t;
    const id = (kind.startsWith("container") ? "ctr:" : kind.startsWith("distro") ? "wsl:" : "proj:") + target;
    void infraAction(kind, target, id).finally(paintResourcesBody);
  });
  body.addEventListener("change", (event) => {
    const which = event.target.dataset?.res;
    if (!which) return;
    if (which === "power") { powerSave = event.target.checked; writeJSON("omp-map-power-save", powerSave); paintPowerSave(); }
    if (which === "frames") {
      if (event.target.checked && !confirm("비활성 브라우저의 페이지 상태가 해제되며 다시 열 때 재로드됩니다. 적용할까요?")) { event.target.checked = false; return; }
      suspendFrames = event.target.checked; writeJSON("omp-map-suspend-frames", suspendFrames);
    }
    if (which === "memory") { writeJSON("omp-map-overview-memory", Math.min(1048576, Math.max(128, Number(event.target.value) || 2048))); paintUmap(true); }
  });
  bindRuntimeDot();
}

// 실행 환경 점: '● omp · claude'. 이 PC 에서 CLI 를 못 찾으면 빨간 점과 함께 빠진 이름을 지운 줄로 보여 준다. 누르면 다시 확인한다.
function bindRuntimeDot() {
  const dot = $("runtime-dot");
  let timer = 0;
  const names = [["omp", "omp"], ["claude", "claude"]];
  function render(current) {
    const missing = names.filter(([id]) => current.status === "ready" ? !current[id] : current.status === "unavailable");
    dot.replaceChildren(Object.assign(document.createElement("i"), { textContent: "●" }),
      ...names.flatMap(([id, label], index) => [index ? " · " : " ", Object.assign(document.createElement(missing.some(([name]) => name === id) ? "s" : "span"), { textContent: label })]));
    dot.dataset.tone = current.status === "checking" || current.status === "unchecked" ? "wait" : missing.length ? "bad" : "ok";
    dot.title = (current.detail || "") + " · 눌러서 다시 확인";
    clearTimeout(timer);
    if (current.status === "checking" || current.status === "unchecked") timer = setTimeout(() => void status(), 1500);
  }
  async function status(recheck = false) {
    try { render(await umapRequest("runtime", {}, recheck ? {} : undefined)); } catch (error) { render({ status: "unavailable", detail: error.message }); }
  }
  dot.addEventListener("click", () => void status(true));
  setInterval(() => { if (!document.hidden) void status(); }, 60000);
  void status();
}
