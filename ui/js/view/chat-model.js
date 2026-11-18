/* omp-live-map · view · 대화 블록의 모델 버튼과 선택창 (검색 + 목록) */

const chatModelLabel = (n) => modelShort(n.model);

function chatModelPickerHTML() {
  return `<div class="cmpick" hidden>
    <input class="cmq" placeholder="모델 검색 (Enter: 첫 항목, Esc: 닫기)" spellcheck="false">
    <div class="cmstat"></div>
    <div class="cmlist"></div>
  </div>`;
}

function chatModelListHTML(mp) {
  const cur = mp.current ? mp.current.provider + "/" + mp.current.id : "";
  return modelMatches(mp).map((m) => {
    const key = m.provider + "/" + m.id;
    return `<button class="cmit${key === cur ? " cur" : ""}" data-pick-p="${esc(m.provider)}" data-pick-id="${esc(m.id)}" title="${esc(key)}">
      <span class="cmn">${esc(m.name || m.id)}</span><span class="cmp">${esc(m.provider)}</span></button>`;
  }).join("") || `<div class="cmempty">맞는 모델 없음</div>`;
}

// paintChat 에서 부른다. 버튼 이름·선택창·안내 문구만 바꾼다.
function paintChatModel(box, node, st) {
  const btn = box.querySelector("button[data-model]");
  const label = chatModelLabel(node);
  if (btn.textContent !== label) btn.textContent = label;
  if (!capsOf(node).model) { btn.title = "Claude Code는 대화 중 모델 변경을 지원하지 않습니다"; return; }
  const mp = modelPick(node.id);
  const pick = box.querySelector(".cmpick");
  const wasHidden = pick.hidden;
  pick.hidden = !mp.open;
  if (mp.open) {
    const stat = mp.loading ? (mp.list.length ? "바꾸는 중…" : "불러오는 중…") : mp.err;
    const s = pick.querySelector(".cmstat");
    s.textContent = stat;
    s.classList.toggle("bad", !!mp.err);
    const list = pick.querySelector(".cmlist");
    const html = mp.loading && !mp.list.length ? "" : chatModelListHTML(mp);
    if (list.__html !== html) { list.__html = html; list.innerHTML = html; }
    const q = pick.querySelector(".cmq");
    if (q.value !== mp.q) q.value = mp.q;
    if (wasHidden) q.focus();
  }
  const note = box.querySelector(".cmnote");
  const text = st.modelNote || "";
  if (note.textContent !== text) note.textContent = text;
  note.hidden = !text;
}

function mountChatModel(box, id) {
  const pick = box.querySelector(".cmpick");
  const q = pick.querySelector(".cmq");
  q.addEventListener("input", () => { modelPick(id).q = q.value; paintChat(id); });
  // Esc 는 검색창뿐 아니라 목록 항목에 초점이 있어도 닫는다. 카드 닫기(전역 Esc)로 번지지 않게 막는다.
  pick.addEventListener("keydown", (e) => {
    const mp = modelPick(id);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); mp.open = false; paintChat(id); }
    else if (e.key === "Enter" && e.target === q) {
      e.preventDefault();
      const first = modelMatches(mp)[0];
      if (first && !mp.loading) pickModel(id, first.provider, first.id);
    }
  });
}
