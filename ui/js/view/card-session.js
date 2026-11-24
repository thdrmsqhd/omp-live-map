/* omp-live-map · view · 큰 카드(크롬 = 헤더·지표, 바디 = 블록) */
//
// 큰 카드는 .chrome 과 .body 두 덩어리다. 스냅샷이 바뀌면 .chrome 만 갈아 끼우고,
// 블록이 사는 .body 는 블록 구성(data-sig)이 같으면 DOM 을 그대로 둔다(patch-nodes.js).

// 부제 원문 전체(subtitleOf 는 세션 제목을 자른다).
function subtitleFull(n, isLocal) {
  const main = n.synthetic && !isLocal ? "원본 기록 없음" : (n.title || n.firstUser || subtitleOf(n, isLocal));
  const extra = String(n.sessionTitle || "").trim();
  return extra && !String(main).includes(extra) ? main + " · " + extra : main;
}

function nameField(n) {
  return renamingId === n.id
    ? `<input class="rename big" data-id="${esc(n.id)}" value="${esc(displayName(n))}">`
    : `<span class="nm" title="더블클릭: 이름 변경">${esc(displayName(n))}</span>`;
}

// 서브에이전트가 쓴 프로필 칩(예: 정밀-구현). 정의가 없는 내장 이름(task·sonic)은 노드 모델을 title 에 쓴다.
function profileChip(n) {
  if (n.kind !== "sub" || !n.agent) return "";
  const t = [`프로필 ${n.agent}${n.agent === "task" ? " (기본)" : ""}`, n.agentModel || n.model ? `모델 ${n.agentModel || n.model}` : "", n.agentThinking ? `사고 ${n.agentThinking}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `<span class="prof" title="${esc(t)}">${esc(n.agent)}</span>`;
}

// 모델 칩. 서브에이전트는 기록 모델이 없으면 프로필에 적힌 모델을 쓴다.
function modelChip(n) {
  const m = n.model || n.agentModel || "";
  return `<span class="mod" title="${esc(n.provider ? n.provider + " · " : "")}${esc(m || "?")}">${esc(modelShort(m))}</span>`;
}

function sessionChrome(n) {
  const isLocal = n.kind === "local";
  const series = n.series || [];
  const maxOut = series.length ? Math.max(...series.map((s) => s.out || 0)) : 0;
  return `<div class="hd session-hd"><i class="dot ${n.status}" title="${esc(dotTitle(n))}"></i>
      ${nameField(n)}
      ${isLocal ? "" : harnessChip(n)}
      ${askBadge(n.id)}<span class="attn-badge"></span>
      ${!isLocal && n.startedAt ? `<span class="since" title="시작 ${esc(new Date(n.startedAt).toLocaleString("ko-KR"))}">시작 ${ago(n.startedAt)}</span>` : ""}
      <button class="x" data-rename="${esc(n.id)}" title="이름 변경${isLocal ? "" : " (비우면 원래 이름)"}">✎</button>
      ${isLocal ? `<button class="x" data-del="${esc(n.id)}" title="카드 삭제" aria-label="카드 삭제">🗑</button>` : n.kind === "main" ? `<button class="x danger session-close" data-dismiss="1" ${STOP_PENDING.has(n.id) ? "disabled" : ""} title="세션 종료 요청 (카드 유지)">${STOP_PENDING.has(n.id) ? "종료 요청 중…" : "세션 종료"}</button>` : ""}
      ${profileChip(n)}${typeof dockTag === "function" ? dockTag(n) : ""}${isLocal ? `<span class="mod">local</span>` : n.kind === "sub" || !cardBlockTypes(n).includes("chat") ? modelChip(n) : ""}
      ${cardWindowActions(n.id)}</div>
    <div class="sub-t${SUB_OPEN.has(n.id) ? " open" : ""}" data-subtoggle="${esc(n.id)}" title="${esc(subtitleFull(n, isLocal))}">${esc(subtitleOf(n, isLocal))}</div>
    ${isLocal ? resRow(n, true) : `${tokenSection(n)}
    <div class="sparkwrap" style="height:34px">
      <span class="rate">${n.liveTokPerSec} t/s</span>
      ${spark(series, BIG_W - 40, 30, "#2fbf9b", true, n.id)}
      <span class="cap">턴당 출력 max ${fmt(maxOut)} · 최근 ${series.length}턴</span>
    </div>
    ${ctxBlock(n)}
    ${sessionCtxBlock(n)}
    <div class="chips">${toolChips(n)}${progChips(programs(n))}</div>
    ${resRow(n, true)}`}`;
}

function infraChrome(n) {
  const c = n.kind === "container" ? INFRA.containers.find((x) => "ctr:" + x.id === n.id) : null;
  const acts = infraActions(n, true);
  return `<div class="hd"><i class="dot ${n.status}"></i><span class="nm">${esc(n.name)}</span>
      <span class="mod">${esc(n.kind)}</span>
      ${cardWindowActions(n.id)}</div>
    <div class="sub-t">${esc([n.meta1, n.meta2].filter(Boolean).join(" · "))}</div>
    ${c ? `<div class="chips">
      <span class="chip">image ${esc(modelShort(c.image))}</span>
      <span class="chip">state ${esc(c.state)}</span>
      ${c.ports ? `<span class="chip">ports ${esc(c.ports)}</span>` : ""}
      <span class="chip">${esc(c.project)}${c.service ? " / " + esc(c.service) : ""}</span></div>` : ""}
    ${acts ? `<div class="chips">${acts}</div>` : ""}`;
}

function bigCard(n) {
  const box = SATS.get(n.id);
  const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;--edcol:${cardSplit(n.id)}%`;
  const chrome = agentKind(n.kind) || n.kind === "local" ? sessionChrome(n) : infraChrome(n);
  const side = renderBlocks(n, "side");
  const edit = renderBlocks(n, "edit");
  const left = renderBlocks(n, "left");
  const dock = typeof dockClassOf === "function" ? dockClassOf(n.id) : "";
  return `<div class="node big ${n.kind} ${n.status}${dock ? " " + dock : ""}" data-id="${esc(n.id)}" style="${style}">
    <div class="chrome">${chrome}</div>
    <div class="body" data-sig="${esc(blockSig(n))}">
      ${left ? `<div class="col-left">${left}</div>` : ""}
      <div class="col-rest">
        <div class="col-main">${renderBlocks(n, "main")}</div>
        ${edit ? `<div class="edsplit" title="끌어서 대화·편집기 폭 조절 · 더블클릭으로 원래대로"></div><div class="col-ed">${edit}</div>` : ""}
        ${side ? `<div class="col-tree">${side}</div>` : ""}
      </div>
    </div>
    ${resizeGrip()}
  </div>`;
}

// 큰 카드 크롬 안의 클릭. 처리했으면 true.
function chromeClick(target, id) {
  const pick = (attr) => target.closest(`[${attr}]`);
  const toggle = (set) => { if (set.has(id)) set.delete(id); else set.add(id); renderMap(false, true); return true; };
  if (pick("data-ctxmore")) return toggle(CTX_OPEN);
  if (pick("data-toolsmore")) return toggle(TOOLS_OPEN);
  if (pick("data-subtoggle")) return toggle(SUB_OPEN);
  if (pick("data-tokscope")) {
    if (TOK_SCOPE.get(id) === "1h") TOK_SCOPE.delete(id); else TOK_SCOPE.set(id, "1h");
    renderMap(false, true);
    return true;
  }
  const tool = pick("data-tool");
  if (tool) { toggleChatTool(id, tool.dataset.tool); return true; }
  const row = pick("data-ctxnode");
  if (row) { focusCard(row.dataset.ctxnode); return true; }
  return false;
}

// 이름 입력 확정: 로컬 카드는 제목을, 나머지는 별칭을 바꾼다(비우면 원래 이름).
function commitRename(id, value) {
  renamingId = null;
  const L = LOCALS.find((l) => l.id === id);
  if (L) {
    if (value) { L.title = value; saveLocals(); }
  } else {
    const n = nodeById(id);
    const base = n && (n.kind === "main" ? n.sessionTitle || "main" : n.name);
    if (value && value !== base) ALIAS.set(id, value); else ALIAS.delete(id);
    saveAlias();
  }
  renderMap(false, true);
}

function wireRename(input) {
  if (!input || input.dataset.wired) return;
  input.dataset.wired = "1";
  const id = input.dataset.id;
  input.focus();
  input.select();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitRename(id, input.value.trim()); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); renamingId = null; renderMap(false, true); }
  });
  input.addEventListener("blur", () => { if (renamingId === id) commitRename(id, input.value.trim()); });
}
