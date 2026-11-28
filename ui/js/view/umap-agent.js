/* omp-live-map · view · 한 맵의 에이전트·서브에이전트 카드와 활동 서랍.
   카드는 누르지 않아도 문장으로 읽힌다: 제목(세션 제목·서브에이전트 이름) · 목표 · 지금 하는 일(끝났으면 결과) · 최근 한 일 3개 · 작은 카운터.
   문장은 model/agent-lines.js umapAgentLines 가 만들고(viewmodel 이 item.lines 로 싣는다), 배율과 상관없이 같은 내용·크기다.
   최근 한 일 줄을 누르면 서랍에서 그 파일 diff(수정) 또는 대화 그 자리를 연다. 카드 빈 곳·제목 단추(키보드 Tab·Enter) = 서랍, 두 번 누르기 = 세션 전체 화면.
   단계에 합친 세션(model/task-map.js umapStageAgent)은 단계 카드가 umapAgentRows 로 같은 문장 줄을 그린다(view/umap-render.js). */

const umapHHMM = (ts) => (ts ? new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const umapBase = umapBaseName;
function umapNodeOf(id) {
  for (const session of DATA.sessions || []) for (const node of session.nodes || []) if (node.id === id) return { node: { ...node, sessionTitle: session.title }, session };
  return null;
}

function umapAgentHTML(item, box, dim) {
  const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
  const manual = box.manual ? " manual" : "";
  if (!item.node) {
    return `<article class="um-card um-agent missing${manual}" data-key="${esc(box.key)}" style="${style}" title="세션 ${esc(item.entry.sessionId)} · 이 PC 기록(지금 기간)에 없습니다"><i class="um-adot"></i><span>세션 ${esc(item.entry.sessionId.slice(0, 8))} · 이 PC 기록(지금 기간)에 없음</span></article>`;
  }
  const n = item.node, L = item.lines || umapLinesOf(n);
  const attempt = item.entry ? `<small class="um-attempt">시도 ${item.entry.attempt}${item.entry.retry ? "·재" + item.entry.retry : ""}</small>` : "";
  const cls = `um-card um-agent a-${L.state}${L.sub ? " sub" : ""}${dim ? " um-dim" : ""}${manual}`;
  const top = `<div class="um-agent-top"><i class="um-adot"></i>${L.sub ? '<small class="um-tag">서브</small>' : ""}<button class="um-aname" data-um="agent" title="${esc(L.title)} · 활동 서랍">${esc(L.title)}</button>`
    + `<span class="um-spacer"></span>${harnessChip(n)}<span class="um-astate">${esc(L.label)}</span>${attempt}<button data-um="open" title="세션 열기 (더블클릭)">열기</button></div>`;
  return `<article class="${cls}" data-key="${esc(box.key)}" data-node="${esc(n.id)}" style="${style};--c:${L.color}" title="눌러서 활동 서랍 · 두 번 눌러 세션 열기">${top}${umapAgentRows(L, item)}</article>`;
}
// 에이전트 문장 줄: 목표 · 지금(끝났으면 결과, error 가 있으면 그 오류) · 최근 한 일(누르면 diff·대화 자리) · 카운터. 줄 높이는 UMAP_AGENT.ROW 로 고정.
function umapAgentRows(L, item, { error = "" } = {}) {
  const kids = item?.children?.length ? `<small class="um-kids">서브 ${item.children.length}</small>` : "";
  const rows = [`<div class="um-goal" title="${esc(L.goal)}"><em>목표</em> ${esc(L.goal)}</div>`,
    error ? `<div class="um-result err" title="${esc(error)}"><em>오류</em> ${esc(error)}</div>`
      : L.result ? `<div class="um-result${L.state === "failed" ? " err" : ""}" title="${esc(L.result)}"><em>결과</em> ${esc(L.result)}</div>`
      : `<div class="um-now" title="${esc(L.now)}"><em>지금</em> ${esc(L.now)}</div>`];
  if (L.recent.length) {
    rows.push(`<ol class="um-recent">${L.recent.map((it) => `<li data-um="act-item" data-ts="${Number(it.ts) || 0}"${it.file ? ` data-file="${esc(it.file)}"` : ""}${it.bad ? ' class="bad"' : ""} title="${esc(it.text)} · 눌러서 ${it.file ? "diff" : "대화 그 자리"}"><span>${esc(it.text)}</span><time>${esc(umapHHMM(it.ts))}</time></li>`).join("")}</ol>`);
  }
  if (L.counters || kids) rows.push(`<div class="um-counters"><button data-um="act-edits" title="읽은 파일·고친 파일·명령 · 눌러서 자세히">${esc(L.counters || "기록된 툴 사용 없음")}</button>${kids}</div>`);
  return rows.join("");
}

// 서랍: 에이전트 활동(목표·결과·수정 diff·명령·읽은 파일·최근 활동·대화). focus: 'edits'|'cmds'|'reads'|'talk', at: 대화 자리(ts), file: 그 파일 diff.
async function openAgentDrawer(id, focus = "edits", { at = 0, file = "" } = {}) {
  const found = umapNodeOf(id);
  if (!found) return;
  const n = found.node, act = n.act || {}, L = umapLinesOf(n);
  const sec = (key, title, ...children) => { const el = umapSection(title, ...children); if (key === focus) el.classList.add("um-focus"); el.dataset.sec = key; return el; };
  const li = (text, cls = "") => umEl("li", { className: cls }, umEl("span", { textContent: text, title: text }));
  const edits = file ? (act.edits || []).filter((e) => e.file === file) : act.edits || [];
  const diffBox = umEl("div", { className: "um-diffs" }, umEl("small", { className: "um-note", textContent: edits.length ? "수정 내역 불러오는 중…" : "고친 파일이 없습니다." }));
  const body = [
    sec("head", (L.sub ? "서브에이전트 · " : "") + L.title + (n.agent && n.agent !== n.name && n.agent !== "task" ? " (" + n.agent + ")" : "") + " · " + L.label,
      umEl("p", { className: "um-dstate", textContent: "목표: " + (act.goal || n.firstUser || "—") }),
      L.now ? umEl("p", { className: "um-dstate", textContent: "지금: " + L.now }) : null,
      L.result ? umEl("p", { className: "um-dstate", textContent: "결과: " + L.result }) : null,
      umEl("button", { type: "button", textContent: "세션 열기 (전체 화면)", onclick: () => { closeUmapDrawer(); umapOpenSession(id); } })),
    sec("edits", "수정한 파일 " + (act.edits || []).length + (file ? " · " + umapBase(file) : ""), diffBox),
    sec("cmds", "명령 " + (act.counts?.commands || 0), umEl("ul", { className: "um-dlist" }, ...(act.commands || []).slice().reverse().map((c) => li((c.ok === null ? "… " : c.ok ? "✓ " : "✗ ") + c.cmd, c.ok === false ? "bad" : "")))),
    sec("reads", "읽은 파일 " + (act.counts?.reads || 0), umEl("ul", { className: "um-dlist" }, ...(act.reads || []).map((r) => li(r.file + (r.n > 1 ? " ×" + r.n : ""))))),
    sec("talk", "대화", umapTalk(n, at)),
  ];
  openUmapDrawer("agent", id, L.title, body, true);
  const target = $("umap-drawer-body").querySelector(".um-focus");
  if (target) target.scrollIntoView({ block: "start" });
  const hit = $("umap-drawer-body").querySelector(".um-talk .hit");
  if (hit) hit.scrollIntoView({ block: "center" });
  if (!edits.length) return;
  const parts = [];
  for (const edit of edits.slice(-8).reverse()) {
    let hunks = [];
    try { const r = await (await postJSON("/api/chat/edits", { node: id, file: edit.file })).json(); if (r.ok) hunks = r.hunks; } catch { /* 서버가 기록을 잃었으면 카운터만 */ }
    parts.push(umEl("div", { className: "um-diff-file" }, umEl("b", { textContent: edit.file + "  +" + edit.add + " −" + edit.del }), ...hunks.map(umapHunk),
      umEl("button", { type: "button", textContent: "지금 Git Diff", onclick: (event) => void umapGitDiff(event.target, id, edit.file) })));
  }
  if (UMD.key === id) diffBox.replaceChildren(...parts);
}
// 편집 조각 하나 → 줄 단위 diff(앞뒤 같은 줄은 맥락 줄).
function umapHunk(h) {
  const pre = umEl("pre", { className: "um-diff" });
  const line = (cls, text) => pre.append(umEl("span", { className: cls, textContent: text || " " })); // 줄마다 block 이라 줄바꿈 글자는 넣지 않는다
  if (h.patch) for (const l of String(h.patch).split("\n")) line(/^\+/.test(l) ? "add" : /^-/.test(l) ? "del" : "ctx", l);
  else {
    const a = String(h.old || "").split("\n"), b = String(h.new || "").split("\n");
    let head = 0, tail = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    for (const l of a.slice(Math.max(0, head - 2), head)) line("ctx", "  " + l);
    for (const l of a.slice(head, a.length - tail)) if (!h.write) line("del", "- " + l);
    for (const l of b.slice(head, b.length - tail)) line("add", "+ " + l);
    for (const l of a.slice(a.length - tail, a.length - tail + 2)) line("ctx", "  " + l);
  }
  return umEl("div", { className: "um-hunk" }, umEl("small", { textContent: umapHHMM(h.ts) + (h.write ? " · 새로 씀" : "") + " · +" + (h.add || 0) + " −" + (h.del || 0) }), pre);
}
async function umapGitDiff(button, id, file) {
  try {
    const r = await (await postJSON("/api/chat/diff", { node: id, file })).json();
    button.replaceWith(umEl("pre", { className: "um-log", textContent: r.out || "(변경 없음)" }));
  } catch (error) { button.textContent = error.message; }
}
// 대화: 그 세션의 최근 메시지. at(ts)에 가장 가까운 메시지를 표시해 그 자리로 옮긴다.
function umapTalk(n, at) {
  const messages = (n.messages || []).slice(-60);
  let best = -1;
  if (at) messages.forEach((m, i) => { if ((m.ts || 0) <= at + 1000 && (best < 0 || (m.ts || 0) >= (messages[best].ts || 0))) best = i; });
  if (!messages.length) return umEl("small", { className: "um-note", textContent: "대화 기록이 아직 없습니다." });
  return umEl("ol", { className: "um-talk" }, ...messages.map((m, i) => umEl("li", { className: "r-" + m.role + (i === best ? " hit" : "") },
    umEl("small", { textContent: umapHHMM(m.ts) + " · " + ({ user: "지시", assistant: "응답", result: "결과" }[m.role] || m.role) + (m.tools?.length ? " · " + m.tools.join(", ") : "") }),
    umEl("p", { textContent: cut(m.text || (m.tools ? "(툴 " + (m.n || 1) + "회)" : ""), 600) }))));
}
