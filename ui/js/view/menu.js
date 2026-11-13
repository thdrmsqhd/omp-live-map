/* omp-live-map · view · 컨텍스트 메뉴(빈 바탕·카드)와 로컬 카드 추가/삭제 */

function closeMenu() { $("ctxmenu").classList.remove("open"); }

// items: [{ label, hint?, disabled?, title?, run } | null(구분선)]
function showMenu(clientX, clientY, items) {
  const menu = $("ctxmenu");
  menu.innerHTML = items.map((it, i) => (it
    ? `<button data-i="${i}"${it.disabled ? " disabled" : ""}${it.title ? ` title="${esc(it.title)}"` : ""}>${esc(it.label)}${it.hint ? `<span class="mh">${esc(it.hint)}</span>` : ""}</button>`
    : '<div class="sep"></div>')).join("");
  menu.classList.add("open");
  // 화면 밖으로 나가지 않게 메뉴 크기만큼 안쪽으로 당긴다.
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(clientX, innerWidth - r.width - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(clientY, innerHeight - r.height - 4)) + "px";
  menu.onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b) return;
    ev.stopPropagation();
    closeMenu();
    items[+b.dataset.i].run();
  };
}

function addLocal(x, y) {
  const id = "local_" + Date.now().toString(36) + "_" + (localSeq++);
  LOCALS.push({ id, title: "로컬 작업 " + (LOCALS.length + 1), cwd: ENV.localCwd || ENV.home || "", x, y, createdAt: Date.now() });
  saveLocals();
  openNode(id);
}

function deleteLocal(id) {
  const L = LOCALS.find((l) => l.id === id);
  if (!L || !confirm(`'${L.title}' 카드를 삭제할까요?`)) return;
  LOCALS = LOCALS.filter((l) => l.id !== id);
  saveLocals();
  TERM.delete(id);
  TREES.delete(id);
  DBUI.delete(id);
  if (DBPROF.has(id)) saveDbProfiles(id, []);
  if (CARD_BLOCKS.delete(id)) saveBlocks();
  if (CARD_UI.delete(id)) saveCardUI();
  if (openIds.has(id)) closeCard(id);
  if (BIGPOS.delete(id)) saveOpenCards();
  if (renamingId === id) renamingId = null;
  renderMap(false, true);
}

const BLOCK_LABELS = { chat: "채팅", context: "컨텍스트", terminal: "터미널", bg: "백그라운드 잡", files: "파일 트리", browser: "브라우저", db: "DB 조회" };

// 카드 종류별로 붙일 수 있는 블록. 로컬 카드는 세션이 아니라 채팅이 없고, 인프라 카드는 사이드 컬럼(파일)을 쓰지 않는다.
const blockChoices = (n) => (agentKind(n.kind) ? Object.keys(BLOCK_LABELS)
  : n.kind === "local" ? ["terminal", "bg", "files", "browser", "db"] : ["terminal", "bg", "browser"]);

function blockMenuItems(n) {
  const cur = cardBlockTypes(n);
  return blockChoices(n).map((t) => {
    const on = cur.includes(t);
    const last = on && cur.length <= 1;
    return {
      label: `${BLOCK_LABELS[t]} 블록 ${on ? "제거" : "추가"}`,
      hint: t === "bg" && on && !(BGS.get(n.id) || []).some(jobVisible) ? "잡 없음" : "",
      disabled: last, title: last ? "마지막 블록은 제거할 수 없습니다" : "",
      run: () => toggleBlock(n.id, t),
    };
  });
}

function hideSession(id, key = sessionKeyOfNode(id)) {
  if (!key) return;
  HIDDEN.add(key);
  PINNED.delete(key);
  saveHidden();
  savePinned();
  if (openIds.has(id)) closeCard(id);
  renderMap(false, true);
}

// 맵 소유 omp 종료와 귀속 프로세스 정리를 함께 요청한 뒤 카드 자리를 비운다.
async function closeSession(id) {
  const key = sessionKeyOfNode(id);
  if (!key) return;
  try {
    await Promise.all([
      postJSON("/api/session/stop", { node: id }),
      postJSON("/api/release", { node: id }),
    ]);
    hideSession(id, key);
  } catch (err) { alert("세션을 닫지 못했습니다: " + err.message); }
}

async function releaseSession(id) {
  if (!confirm("이 세션에 귀속된 프로세스를 종료해 리소스를 해제할까요? (에이전트 자체는 건드리지 않습니다)")) return;
  try {
    const res = await postJSON("/api/release", { node: id });
    const out = await res.json();
    alert(out.ok ? `종료 ${out.killed.length}개 · 약 ${out.freedMB}MB 해제` : ("종료할 프로세스 없음" + (out.out ? " · " + out.out : "")));
  } catch (err) { alert("실패: " + err.message); }
}

function openCardMenu(clientX, clientY, id) {
  const n = nodeById(id);
  if (!n) return;
  const key = sessionKeyOfNode(id);
  const items = [
    { label: openIds.has(id) ? "카드 축소" : "카드 열기", hint: openIds.has(id) ? "− 버튼" : "더블클릭", run: () => openNode(id) },
    null,
    ...blockMenuItems(n),
  ];
  if (n.kind === "local") items.push(null, { label: "카드 삭제", run: () => deleteLocal(id) });
  else if (key) {
    items.push(null,
      { label: "프로세스 정리만", run: () => releaseSession(id) },
      { label: "세션 숨기기만", run: () => hideSession(id, key) },
      { label: PINNED.has(key) ? "고정 해제" : "세션 고정", run: () => {
        if (PINNED.has(key)) PINNED.delete(key); else PINNED.add(key);
        savePinned(); renderMap(false, true);
      } });
  }
  showMenu(clientX, clientY, items);
}

function openStageMenu(clientX, clientY) {
  const pt = worldPoint(clientX, clientY);
  showMenu(clientX, clientY, [
    { label: "+ 새 세션", run: () => openNewSession() },
    { label: "+ 새 로컬 카드 (터미널·파일)", hint: "Ctrl+N", run: () => addLocal(pt.x, pt.y) },
    null,
    { label: "전체 보기", hint: "0", run: fit },
    { label: "배치 되돌리기", hint: "Ctrl+Z", disabled: !HISTORY.length, run: undoLayout },
  ]);
}

$("stage").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const card = e.target.closest(".node[data-id], .node[data-ghost]");
  if (card) openCardMenu(e.clientX, e.clientY, card.dataset.id || card.dataset.ghost);
  else openStageMenu(e.clientX, e.clientY);
});

document.addEventListener("click", (e) => { if (!e.target.closest("#ctxmenu")) closeMenu(); });
