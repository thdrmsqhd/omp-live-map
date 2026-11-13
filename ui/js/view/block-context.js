/* omp-live-map · view · context 블록 (지금 이 세션이 실어 나르는 컨텍스트 + 작업 가이드·압축 편집) */
//
// 서버는 세션 기록에서 마지막 압축 요약 + 그 뒤 남은 메시지·툴 결과를 순서대로 준다.
// 편집은 omp 가 실제로 받는 두 가지뿐이다: 가이드 프롬프트(steer) 와 compact(customInstructions).

function ctxItemHTML(it, picked) {
  const tok = `<span class="tk">${fmt(it.tokens)} tok</span>`;
  const pick = `<label class="ctpick" title="압축 요약에서 빼기"><input type="checkbox" data-ctpick="${it.i}"${picked ? " checked" : ""}></label>`;
  if (it.kind === "tool") {
    return `<div class="cti k-tool${picked ? " pick" : ""}">${pick}
      <details class="ctd"><summary><span class="k">${esc(it.tool || "tool")}</span>${tok}
        ${it.error ? '<span class="tm err">error</span>' : ""}<span class="tm">${fmt(it.chars)}자</span></summary>
        <pre>${esc(it.text || "(출력 없음)")}</pre></details></div>`;
  }
  const tools = it.tools && it.tools.length ? `<span class="tm">도구 ${esc(it.tools.join(", "))}</span>` : "";
  const sum = it.kind === "summary" ? `<span class="tm">${fmt(it.before)} → ${fmt(it.after)} tok</span>` : "";
  const trunc = it.trunc ? `<span class="tm">${fmt(it.chars)}자 중 일부</span>` : "";
  return `<div class="cti k-${esc(it.kind)}${picked ? " pick" : ""}">${pick}
    <div class="ctb"><div class="cthd"><span class="k">${esc(it.label)}</span>${tok}${tools}${sum}${trunc}</div>
    <div class="cttext">${esc(it.text || "(내용 없음)")}</div></div></div>`;
}

function ctxItemsHTML(st) {
  const d = st.data;
  if (!d) return st.error ? `<div class="ctn err">${esc(st.error)}</div>` : '<div class="ctn">불러오는 중…</div>';
  if (!d.items || !d.items.length) return '<div class="ctn">컨텍스트에 실린 항목이 없습니다</div>';
  return d.items.map((it) => ctxItemHTML(it, st.omit.has(it.i))).join("");
}

const ctxSumText = (st) => {
  const d = st.data;
  if (!d) return st.error ? "읽지 못했습니다" : "불러오는 중…";
  return `${d.count}항목 · 약 ${fmt(d.totalTokens)} tok`;
};

const ctxOwnText = (st) => (st.data ? (st.data.owned ? "맵 세션 · 편집 가능" : "터미널/미점유 · 보기") : "");

function ctxBlockMarkup() {
  return `<div class="ctxblk">
    <div class="cthead"><span class="ctsum"></span><span class="ctown"></span>
      <button data-ctxreload title="기록에서 다시 읽기">↻</button></div>
    <div class="ctlist"></div>
    <div class="ctedit">
      <textarea class="ctin" rows="2" placeholder="작업 가이드 — 이 세션이 지금 이해해야 할 내용 (Ctrl+Enter)"></textarea>
      <div class="ctrow">
        <button data-ctguide title="작업 가이드를 프롬프트로 보냅니다. 에이전트가 도는 중이면 steer 로 끼워 넣습니다.">가이드 보내기</button>
        <button data-ctcompact title="omp compact 에 지시문을 붙여 컨텍스트를 압축합니다. 체크한 항목은 요약에서 뺍니다.">선택 빼고 압축</button>
        <span class="ctmsg"></span>
      </div>
    </div>
  </div>`;
}

// 목록만 갱신한다(같은 HTML 이면 DOM 을 그대로 두어 스크롤·펼친 툴이 유지된다).
function paintContext(id) {
  const el = ELS.get(id);
  const box = el && el.querySelector(".ctxblk");
  const st = CTX.get(id);
  if (!box || !st) return;
  box.querySelector(".ctsum").textContent = (st.loading ? "읽는 중… " : "") + ctxSumText(st);
  box.querySelector(".ctown").textContent = ctxOwnText(st);
  const list = box.querySelector(".ctlist");
  const html = ctxItemsHTML(st);
  if (list.__html !== html) {
    const top = list.scrollTop;
    list.__html = html;
    list.innerHTML = html;
    list.scrollTop = top;
  }
  const msg = box.querySelector(".ctmsg");
  msg.textContent = st.msg || "";
  msg.classList.toggle("err", !!st.error || /^실패/.test(st.msg || ""));
  const busy = !!st.busy;
  box.querySelector("[data-ctguide]").disabled = busy;
  box.querySelector("[data-ctcompact]").disabled = busy || !st.data;
  const ta = box.querySelector(".ctin");
  if (ta.value !== st.draft) ta.value = st.draft;
}

function mountContext(blk, n) {
  const id = n.id;
  const box = blk.querySelector(".ctxblk");
  const st = ctxState(id);
  const ta = box.querySelector(".ctin");
  ta.value = st.draft;
  ta.addEventListener("input", () => { st.draft = ta.value; });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); editContext(id, "guide"); }
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.ctxreload != null) loadContext(id, true);
    else if (b.dataset.ctguide != null) editContext(id, "guide");
    else if (b.dataset.ctcompact != null) editContext(id, "compact");
  });
  box.addEventListener("change", (e) => {
    const c = e.target.closest("input[data-ctpick]");
    if (c) toggleCtxOmit(id, c.dataset.ctpick);
  });
  paintContext(id);
  loadContext(id, true);
}

registerBlock({ type: "context", slot: "main", flex: 1, render: () => ctxBlockMarkup(), mount: mountContext, paint: (box, n) => loadContext(n.id) });
