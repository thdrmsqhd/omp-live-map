/* omp-live-map · view · 비활성 세션 검색(고르면 고정해서 맵에 올린다) */

function renderSearch() {
  const box = $("searchResults");
  const q = ($("search").value || "").trim().toLowerCase();
  const shown = new Set(filteredSessions().map((s) => s.key));
  const hits = DATA.sessions
    .filter((s) => !shown.has(s.key))
    .filter((s) => !q || (s.title + " " + s.folder).toLowerCase().includes(q))
    .slice(0, 14);
  box.innerHTML = hits.length ? hits.map((s) => `<div class="sres" data-key="${esc(encodeURIComponent(s.key))}">
      <div class="t">${esc(s.title)}</div>
      <div class="m">${esc(s.folder)} · ${s.totals.agents} agent · ${fmt(s.totals.tokens)} tok · ${krw(s.totals.cost)} · ${ago(s.lastTs)}</div>
    </div>`).join("") : `<div class="sres"><div class="m">${q ? "검색 결과 없음" : "지금 필터 밖에 있는 세션이 없습니다"}</div></div>`;
  box.classList.add("open");
}

$("search").addEventListener("focus", renderSearch);

$("search").addEventListener("input", renderSearch);

$("search").addEventListener("keydown", (e) => { if (e.key === "Escape") e.target.blur(); });

$("search").addEventListener("blur", () => setTimeout(() => $("searchResults").classList.remove("open"), 180));

$("searchResults").addEventListener("click", (e) => {
  const row = e.target.closest("[data-key]");
  if (!row) return;
  const key = decodeURIComponent(row.dataset.key);
  PINNED.add(key);
  HIDDEN.delete(key);
  savePinned();
  saveHidden();
  $("search").value = "";
  $("searchResults").classList.remove("open");
  renderMap(false, true);
  focusSession(key);
});

// 클러스터 제목의 "고정됨 ✕"
document.addEventListener("click", (e) => {
  const u = e.target.closest("[data-unpin]");
  if (!u) return;
  PINNED.delete(decodeURIComponent(u.dataset.unpin));
  savePinned();
  renderMap(false, true);
});
