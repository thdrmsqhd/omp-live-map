/* omp-live-map · view · 편집기 크롬: 탐색기 폭·접힘(전 카드 공유), 탭 클릭·사이드바 끌기, 고정 탭, 브레드크럼 */

const ED_UI = Object.assign({ w: 220, hide: false }, readJSON("omp-map-edui", {}));   // 모든 카드가 공유하는 탐색기 폭·접힘

function edApplySide(s) {
  s.root.classList.toggle("sbhide", ED_UI.hide);
  s.root.style.setProperty("--edw", ED_UI.w + "px");
  edQ(s, '[data-edact="explorer"]').classList.toggle("on", !ED_UI.hide);
  if (s.editor) s.editor.layout();
}

const edSaveUI = () => writeJSON("omp-map-edui", ED_UI);

function edWireTabs(s) {
  const tabs = edQ(s, ".edtabs");
  tabs.addEventListener("click", (e) => {
    const x = e.target.closest("[data-edclose]");
    if (x) return edCloseTab(s, x.dataset.edclose);
    const t = e.target.closest("[data-path]");
    if (t) edShow(s, t.dataset.path);
  });
  tabs.addEventListener("auxclick", (e) => {   // 가운데 버튼 = 탭 닫기
    const t = e.button === 1 && e.target.closest("[data-path]");
    if (t) { e.preventDefault(); edCloseTab(s, t.dataset.path); }
  });
  tabs.addEventListener("dblclick", (e) => {   // 더블클릭 = 미리보기 탭 고정
    const t = e.target.closest("[data-path]");
    if (t) edPin(s, t.dataset.path);
  });
  edQ(s, '[data-edact="explorer"]').addEventListener("click", () => { ED_UI.hide = !ED_UI.hide; edSaveUI(); for (const x of ED.values()) edApplySide(x); });
  const sash = edQ(s, ".edsash");
  sash.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = ED_UI.w;
    const max = Math.max(160, s.root.clientWidth - 200);
    sash.onpointermove = (ev) => {
      ED_UI.w = Math.max(120, Math.min(max, w0 + ev.clientX - x0));
      edApplySide(s);
    };
    sash.onpointerup = () => { sash.onpointermove = sash.onpointerup = null; edSaveUI(); for (const x of ED.values()) edApplySide(x); };
  });
  sash.addEventListener("dblclick", () => { ED_UI.w = 220; edSaveUI(); for (const x of ED.values()) edApplySide(x); });
}

// 미리보기 탭을 고정 탭으로 바꾼다(이탤릭 해제).
function edPin(s, path) {
  if (s.preview === path) { s.preview = null; edPaintTabs(s); }
}

// 브레드크럼: 탐색기 루트 기준 경로(루트 밖이면 전체 경로)
function edPaintCrumb(s) {
  const box = edQ(s, ".edcrumb");
  if (!s.active) { box.innerHTML = ""; return; }
  const data = TREES.get(s.id);
  const root = String((data && data.path) || "").replace(/\\/g, "/").replace(/\/$/, "");
  const full = s.active.replace(/\\/g, "/");
  const rel = root && full.toLowerCase().startsWith(root.toLowerCase() + "/") ? full.slice(root.length + 1) : full;
  const parts = rel.split("/").filter(Boolean);
  box.innerHTML = parts.map((p, i) => (i === parts.length - 1 ? fileIcon(p) : "") + `<span class="cb${i === parts.length - 1 ? " last" : ""}">${esc(p)}</span>`).join('<i class="cbs">›</i>');
}
