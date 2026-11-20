/* omp-live-map · view · 대화 블록의 서브에이전트 카드: 호출(task)·후속 지시(write agent://)·결과(<task-result>)
   메시지 모양은 server/agent-msgs.js 가 만든다(assistant.calls[], role:"result"). 펼침 상태는 chatState.agOpen 에 둔다. */

const agSet = (st) => st.agOpen || (st.agOpen = new Set());

// 작업 내용의 첫 줄 요약: "# Target" 같은 제목만 있는 줄은 건너뛴다.
function agSummary(text) {
  const lines = String(text || "").split("\n").map((l) => l.replace(/^[#>\-*\s]+/, "").trim()).filter(Boolean);
  return lines.find((l, i) => !/^(Target|Goal|Change|Contract|Acceptance)$/i.test(l)) || lines[0] || "";
}

// 펼침 헤더(div[data-ag]: button 이 아니라 블록 본문 끌기가 맵 이동으로 이어진다) + 마크다운 본문.
function agCard(st, key, cls, head, body) {
  const open = agSet(st).has(key);
  return `<div class="agc ${cls}${open ? " open" : ""}"><div class="agh" data-ag="${esc(key)}" title="클릭: 펼치기·접기">${head}<span class="lvcar">▾</span></div><div class="agbody">${mdHTML(body, true)}</div></div>`;
}

function agentCallsHTML(st, m) {
  return (m.calls || []).map((c, i) => {
    const key = `c:${m.ts}:${i}`;
    if (c.k === "send") return agCard(st, key, "send", `<span class="agk">후속 지시</span><b>→ ${esc(c.to)}</b><span class="agsum">${esc(agSummary(c.task))}</span>`, c.task);
    return agCard(st, key, "call", `<span class="agk">서브에이전트</span><b>${esc(c.name || "(이름 없음)")}</b><span class="agb">${esc(c.agent)}</span><span class="agsum">${esc(agSummary(c.task))}</span>`, c.task);
  }).join("");
}

function agentResultHTML(st, m) {
  const cls = /^completed/i.test(m.status) ? "ok" : /fail|error|exit/i.test(m.status) ? "bad" : "warn";
  const head = `<span class="agk">결과</span><b>${esc(m.id)}</b><span class="agb">${esc(m.agent)}</span><span class="ags ${cls}">${esc(m.status || "?")}</span>${m.duration ? `<span class="agd">${esc(m.duration)}</span>` : ""}`;
  return `<div class="cmsg a ag"><span class="who">agent</span><div class="tx">${agCard(st, `r:${m.id}:${m.ts}`, "res", head, m.text || "(출력 없음)")}</div></div>`;
}

// 블록 안 클릭: 답변 속 링크, 서브에이전트 카드 펼치기. 처리했으면 true.
function chatInlineClick(e, st, id) {
  const pl = e.target.closest("[data-plink]");
  if (pl) { plinkClick(e, pl, id); return true; }
  const h = e.target.closest("[data-ag]");
  if (!h) return false;
  if (Date.now() < suppressClickUntil || String(getSelection()) !== "") return true;   // 끌기 직후·글자 고르는 중
  const open = h.closest(".agc").classList.toggle("open");
  agSet(st)[open ? "add" : "delete"](h.dataset.ag);
  return true;
}
