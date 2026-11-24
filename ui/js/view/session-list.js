/* omp-live-map · view · 왼쪽 세션 목록(세션 = 메인 한 줄 + 들여쓴 서브 줄). 지도에는 열린 큰 카드만 있다 */
// 한 줄: 상태 점 · 이름 · 하네스 칩 · 답 대기/주의 배지 · 닫기, 아래에 지금 하는 일(nowLine). 토큰·모델·리소스는 마우스 오버(title).
// 클릭 = 큰 카드 열기(이미 열려 있으면 그 카드로 이동), 우클릭 = 카드 메뉴. 패널 폭·접힘은 localStorage 에 저장한다.

const SL_KEY = "omp-map-sessions";
const SL_MIN = 200, SL_MAX = 520;
const SL = { w: 270, collapsed: false, ...readJSON(SL_KEY, {}) };
SL.w = Math.min(SL_MAX, Math.max(SL_MIN, Number(SL.w) || 270));
SL.collapsed = SL.collapsed === true;
let slHtml = "";

const saveSL = () => writeJSON(SL_KEY, { w: SL.w, collapsed: SL.collapsed });

function paintSLFrame() {
  const el = $("sessions");
  el.classList.toggle("collapsed", SL.collapsed);
  el.style.width = SL.collapsed ? "" : SL.w + "px";
  $("slToggle").textContent = SL.collapsed ? "›" : "‹";
  $("slToggle").title = SL.collapsed ? "세션 목록 펼치기" : "세션 목록 접기";
}

// 마우스를 올리면 보이는 수치: 카드에서 덜어낸 토큰·스파크·리소스 정보.
function rowTip(n, s) {
  const t = n.tokens || {};
  const lines = [
    `${n.kind === "main" ? s.title : displayName(n)} · ${n.kind} · ${n.status}`,
    s.folder || "",
    `모델 ${modelShort(n.model || n.agentModel || "?")}${n.provider ? " · " + n.provider : ""}`,
    `in ${fmt(t.input || 0)} · out ${fmt(t.output || 0)} · cache ${fmt(t.cacheRead || 0)} tok · 요청 ${n.requests || 0}회`,
    n.liveTokPerSec ? `${n.liveTokPerSec.toFixed(1)} t/s` : "",
  ];
  const u = typeof ctxUsage === "function" ? ctxUsage(n) : null;
  if (u) lines.push(`컨텍스트 ${u.text} (${fmt(n.ctx.promptTokens)} / ${fmt(n.ctxWindow)} tok)`);
  if (n.res && n.res.proc) lines.push("리소스 사용 중");
  return lines.filter(Boolean).join("\n");
}

// 메인 행: 서브가 도는 동안 답변 완료 대신 "서브 N개 진행 중"을 보인다.
function subBadge(n) {
  const k = n.kind === "main" ? runningSubsOf(n.id).length : 0;
  return k ? `<span class="sub-badge" title="서브에이전트가 모두 끝나면 답변 완료로 알립니다">서브 ${k}개 진행 중</span>` : "";
}

function rowHTML({ n, depth }, s) {
  const open = openIds.has(n.id);
  const main = n.kind === "main";
  const name = ALIAS.get(n.id) || (main ? s.title : n.name);
  const close = open ? `<button class="x sl-x" data-slclose="1" title="카드 닫기 (세션 유지)" aria-label="카드 닫기">✕</button>` : "";
  const menu = `<button class="x sl-menu" data-slmenu="1" title="카드 메뉴" aria-label="카드 메뉴">⋯</button>`;
  return `<div class="sl-row ${n.kind} ${n.status}${open ? " open" : ""}" data-id="${esc(n.id)}" style="padding-left:${8 + depth * 14}px" title="${esc(rowTip(n, s))}">
    <div class="sl-l1"><i class="dot ${n.status}"></i><span class="nm">${esc(name)}</span>${harnessChip(n)}${askBadge(n.id)}<span class="attn-badge"></span>${subBadge(n)}${close}${menu}</div>
    ${nowLine(n)}</div>`;
}

function sessionHTML({ s, items, doneTotal, hidden }) {
  const folded = HIDE_DONE_SUBS && doneTotal > 0;
  const fold = folded
    ? `<button class="sl-fold" data-fold="${esc(encodeURIComponent(s.key))}">${hidden ? `완료 서브 ${hidden}개 보기` : "완료 서브 접기"}</button>` : "";
  const pin = PINNED.has(s.key) ? `<button class="x sl-pin" data-unpin="${esc(encodeURIComponent(s.key))}" title="고정 해제">고정됨 ✕</button>` : "";
  return `<div class="sl-sess${s.live ? " live" : ""}" data-key="${esc(encodeURIComponent(s.key))}">${items.map((it) => rowHTML(it, s)).join("")}${pin || fold ? `<div class="sl-foot">${fold}${pin}</div>` : ""}</div>`;
}

// renderMap 마다 부른다. 마크업이 그대로면 DOM 을 건드리지 않는다(클릭·스크롤 보존).
function renderSessionList(sessions) {
  const rows = listRows(sessions);
  $("slCount").textContent = String(rows.length);
  const html = rows.length ? rows.map(sessionHTML).join("") : `<div class="sl-empty">표시할 세션이 없습니다</div>`;
  if (html === slHtml) return;
  slHtml = html;
  $("slList").innerHTML = html;
}

// 검색에서 고른 세션: 목록을 펼치고 그 세션으로 스크롤해 잠깐 강조한다.
function revealSession(key) {
  if (SL.collapsed) { SL.collapsed = false; saveSL(); paintSLFrame(); paintMinimap(); }
  const el = $("slList").querySelector(`.sl-sess[data-key="${CSS.escape(encodeURIComponent(key))}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function bindSessionList() {
  paintSLFrame();
  $("slToggle").onclick = () => { SL.collapsed = !SL.collapsed; saveSL(); paintSLFrame(); paintMinimap(); };
  $("slList").addEventListener("click", (e) => {
    const fold = e.target.closest("[data-fold]");
    if (fold) {
      const key = decodeURIComponent(fold.dataset.fold);
      if (LIST_DONE.has(key)) LIST_DONE.delete(key); else LIST_DONE.add(key);
      return renderSessionList(filteredSessions());
    }
    const unpin = e.target.closest("[data-unpin]");
    if (unpin) { PINNED.delete(decodeURIComponent(unpin.dataset.unpin)); savePinned(); return renderMap(false, true); }
    const row = e.target.closest(".sl-row");
    if (!row) return;
    const id = row.dataset.id;
    const menu = e.target.closest("[data-slmenu]");
    if (menu) { const r = menu.getBoundingClientRect(); return openCardMenu(r.left, r.bottom, id); }
    if (e.target.closest("[data-slclose]")) {
      closeCard(id);
      return renderMap(false, true);
    }
    openNode(id);
  });
  $("slList").addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".sl-row");
    if (!row) return;
    e.preventDefault();
    openCardMenu(e.clientX, e.clientY, row.dataset.id);
  });
  // 오른쪽 가장자리를 끌어 폭을 바꾼다.
  const grip = $("slGrip");
  grip.addEventListener("pointerdown", (e) => {
    if (SL.collapsed) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = SL.w;
    const move = (ev) => { SL.w = Math.min(SL_MAX, Math.max(SL_MIN, w0 + ev.clientX - x0)); paintSLFrame(); paintMinimap(); };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); saveSL(); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
}
