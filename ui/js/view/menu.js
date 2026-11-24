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
  const burls = [...BURL.keys()].filter((k) => k === id || k.startsWith(id + "#"));
  if (burls.length) { for (const k of burls) BURL.delete(k); saveBrowserUrls(); }
  if (openIds.has(id)) closeCard(id);
  if (BIGPOS.delete(id)) saveOpenCards();
  if (renamingId === id) renamingId = null;
  renderMap(false, true);
}

const BLOCK_LABELS = { chat: "채팅", context: "컨텍스트", terminal: "터미널", bg: "백그라운드 잡", editor: "코드 편집기", browser: "브라우저", db: "DB 조회", memo: "메모" };

// 카드 종류별로 붙일 수 있는 블록. 로컬 카드는 세션이 아니라 채팅이 없고, 인프라 카드는 사이드 컬럼(파일)을 쓰지 않는다.
const blockChoices = (n) => (agentKind(n.kind) ? Object.keys(BLOCK_LABELS).filter((t) => (t !== "context" || capsOf(n).context) && (t !== "editor" || n.kind !== "sub"))
  : n.kind === "local" ? ["editor", "terminal", "bg", "browser", "db", "memo"] : ["terminal", "bg", "browser"]);

// 브라우저는 카드당 2개까지: 남은 자리 하나에 '추가' 항목, 인스턴스마다 '제거' 항목을 낸다.
function browserMenuItems(n, cur) {
  const inst = blockInstances(cur, "browser");
  const items = [];
  if (inst.length < blockMax("browser")) {
    const key = inst.includes("browser") ? "browser#2" : "browser";
    items.push({ label: `브라우저 블록 추가${inst.length ? " (2번째)" : ""}`, run: () => toggleBlock(n.id, key) });
  } else {
    items.push({ label: "브라우저 블록 추가", disabled: true, title: "브라우저 블록은 카드당 2개까지입니다" });
  }
  for (const key of inst) {
    const last = cur.length <= 1;
    const url = (BURL.get(burlKey(n.id, key)) || {}).url || "";
    items.push({
      label: `브라우저 블록 제거${inst.length > 1 ? " " + (inst.indexOf(key) + 1) : ""}`,
      hint: url ? url.replace(/^https?:\/\//, "").slice(0, 24) : "",
      disabled: last, title: last ? "마지막 블록은 제거할 수 없습니다" : "",
      run: () => toggleBlock(n.id, key),
    });
  }
  return items;
}

function blockMenuItems(n) {
  const cur = cardBlockTypes(n);
  // 순서는 BLOCK_LABELS(=blockChoices) 를 따르고, browser 자리에서 인스턴스 항목들로 펼친다.
  return blockChoices(n).flatMap((t) => (t === "browser" ? browserMenuItems(n, cur) : [{
    label: `${BLOCK_LABELS[t]} 블록 ${cur.includes(t) ? "제거" : "추가"}`,
    hint: t === "bg" && cur.includes(t) && !(BGS.get(n.id) || []).some(jobVisible) ? "잡 없음" : "",
    disabled: cur.includes(t) && cur.length <= 1,
    title: cur.includes(t) && cur.length <= 1 ? "마지막 블록은 제거할 수 없습니다" : "",
    run: () => toggleBlock(n.id, t),
  }]));
}

function hideSession(id, key = sessionKeyOfNode(id)) {
  // 세션 키가 없어도(아직 스냅샷에 없는 카드) 열린 카드와 화면은 정리한다.
  if (key) {
    HIDDEN.add(key);
    PINNED.delete(key);
    saveHidden();
    savePinned();
  }
  if (openIds.has(id)) closeCard(id);
  // 같은 세션의 다른 열린 카드(서브)가 남으면 필터가 세션을 계속 보여 주므로 함께 닫는다.
  const s = key && DATA.sessions.find((x) => x.key === key);
  if (s) for (const n of s.nodes) if (openIds.has(n.id)) closeCard(n.id);
  renderMap(false, true);
}

// 종료는 카드 닫기·숨김과 별개의 명령이다. 서버 응답 실패를 숨기지 않는다.
const STOP_PENDING = new Set();
async function closeSession(id) {
  if (STOP_PENDING.has(id)) return;
  const n = nodeById(id) || nodeInData(id);
  if (!n || n.kind !== "main") return;
  if (!confirm("세션에 종료를 요청하고 귀속 백그라운드 프로세스를 정리할까요? 카드와 기록은 유지됩니다.")) return;
  STOP_PENDING.add(id);
  renderMap(false, true);
  try {
    const send = async (path) => {
      const response = await postJSON(path, { node: id });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.out || result.error || "HTTP " + response.status);
      return result;
    };
    await send("/api/session/stop");
    const released = await send("/api/release");
    alert("세션 종료 요청을 전송했습니다. 실제 종료 상태는 관제 화면에서 확인하세요." +
      (released.skipped?.length ? " 일부 프로세스 정리 제외: " + released.skipped.length + "개" : ""));
  } catch (e) { alert("종료 또는 정리 실패: " + e.message + "\n카드를 유지합니다. 상태 확인 후 다시 시도하세요."); }
  finally { STOP_PENDING.delete(id); await reloadGraph(); renderMap(false, true); }
}

async function releaseSession(id) {
  if (!confirm("이 세션에 귀속된 프로세스를 종료해 리소스를 해제할까요? (에이전트 자체는 건드리지 않습니다)")) return;
  try {
    const res = await postJSON("/api/release", { node: id });
    const out = await res.json();
    alert(out.ok ? `종료 ${out.killed.length}개 · 약 ${out.freedMB}MB 해제` : ("종료할 프로세스 없음" + (out.out ? " · " + out.out : "")));
  } catch (err) { alert("실패: " + err.message); }
}

// 하네스 전환: 원래 세션 요약을 넘겨 반대 하네스로 이어 간다(카드 id·메모·별칭·자리는 그대로).
async function switchCardHarness(id) {
  const n = nodeById(id);
  if (!n || n.kind !== "main") return;
  const target = capsOf(n).id === "claude" ? "omp" : "claude";
  const label = target === "claude" ? "Claude Code" : "omp";
  if (!confirm(`요약을 넘겨 ${label}로 이어갑니다. 원래 세션 기록은 남습니다`)) return;
  const wasOpen = openIds.has(id);
  SWITCH_HOLD.add(id);
  let out = {};
  try {
    const res = await postJSON("/api/session/switch", { node: id, target });
    out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) { out = { ok: false, out: err.message }; }
  if (!out.ok) { SWITCH_HOLD.delete(id); alert("전환 실패: " + (out.out || "응답 없음")); return; }
  // 카드 화면 상태(로컬 표시분·요약)만 버리고 새 기록 기준으로 다시 그린다.
  CHAT.delete(id);
  CTX.delete(id);
  // 새 세션 파일이 스냅샷(DATA)에 올라올 때까지 기다린다. nodeById(NODES)는 렌더 뒤에만 갱신된다.
  const inData = () => DATA.sessions.some((s) => s.nodes.some((n) => n.id === id));
  for (let i = 0; i < 8; i++) {
    await reloadGraph();
    if (inData()) break;
    await new Promise((done) => setTimeout(done, 400));
  }
  SWITCH_HOLD.delete(id);
  if (wasOpen && inData()) openIds.add(id);
  renderMap(false, true);
}

function openCardMenu(clientX, clientY, id) {
  const n = nodeById(id) || nodeInData(id);   // 접힌 완료 서브는 목록에서만 보이므로 스냅샷에서도 찾는다
  if (!n) return;
  const key = sessionKeyOfNode(id);
  const items = [
    { label: openIds.has(id) ? "카드 닫기" : "카드 열기", hint: openIds.has(id) ? "세션 유지" : "목록 클릭", run: () => toggleCard(id) },
    null,
    ...blockMenuItems(n),
  ];
  if (n.kind === "main") {
    const to = capsOf(n).id === "claude" ? "omp" : "Claude Code";
    items.push(null, { label: to + "로 전환", hint: "요약 이어받기", run: () => switchCardHarness(id) },
      { label: "세션 종료 요청", disabled: STOP_PENDING.has(id), run: () => closeSession(id) });
  }
  if (ATTN.get(id)?.kind === "done") items.push({ label: "완료 알림 확인", run: () => attnClear(id) });
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
    { label: "+ 새 세션", run: () => openNewSession(pt) },
    { label: "+ 새 로컬 카드 (편집기·터미널)", hint: "Ctrl+N", run: () => addLocal(pt.x, pt.y) },
    { label: "+ 새 브라우저 카드", run: () => addBrowserCard(pt.x, pt.y) },
    null,
    { label: "전체 보기", hint: "0", run: fit },
    { label: "배치 되돌리기", hint: "Ctrl+Z", disabled: !HISTORY.length, run: undoLayout },
  ]);
}

$("stage").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const card = e.target.closest(".node[data-id]");
  if (card) openCardMenu(e.clientX, e.clientY, card.dataset.id);
  else openStageMenu(e.clientX, e.clientY);
});

document.addEventListener("click", (e) => { if (!e.target.closest("#ctxmenu")) closeMenu(); });
