/* omp-live-map · view · 스테이지 잡 카드 (백그라운드 잡: 상태·경과·출력 스트리밍) */

// 열어 둔 잡 카드와 그 출력의 스크롤 상태(렌더를 다시 해도 유지한다).
const JOBSTICK = new Map();


// 잡 카드가 보여줄 출력: 맵 세션이면 rpc 로 흐른 출력, TUI 세션이면 끝날 때 붙은 꼬리.
function jobOutText(j) {
  const live = typeof liveOutText === "function" ? liveOutText(j.file, j.toolCallId) : "";
  return (live || (j.tail || []).join("\n")).replace(/\s+$/, "");
}

function jobCard(j, c) {
  const live = jobLive(j);
  const key = jobKeyOf(j);
  const open = JOBOPEN.has(key);
  const lines = liveLines(j);
  const from = j.ts || j.startedAt || 0;
  const took = (live ? Date.now() : j.endedAt || Date.now()) - from;
  const st = live ? "실행 중" : j.status === "failed" ? "실패" : j.status === "cancelled" ? "취소됨" : "종료됨";
  return `<div class="jcard${live ? " run" : ""}${open ? " open" : ""}" data-job="${esc(key)}" data-owner="${esc(j.owner || "")}"
      title="${open ? "눌러서 접기" : "눌러서 출력 보기"}"
      style="left:${j.x - c.x}px;top:${j.y - c.y}px;width:${j.w}px;height:${open ? JOB.OPENH : j.h}px">
    <div class="jh"><i class="dot ${live ? "live" : "done"}"></i><span class="jid">${esc(j.id)}</span>
      <span class="jst ${live ? "run" : "done"}${!live && j.status === "failed" ? " fail" : ""}">${st}${from ? " · " + dur(took) : ""}</span></div>
    <div class="jcmd">${esc(j.cmd || "(명령 미기록)")}</div>
    ${lines.length ? `<pre class="jout" data-job="${esc(key)}">${esc((open ? lines : lines.slice(-1)).join("\n"))}</pre>`
      : `<div class="jnone">${live ? "출력 기다리는 중" : "출력 없음"}</div>`}
  </div>`;
}

// 보여줄 줄: 펼치면 끝 200줄, 접히면 마지막 한 줄.
function liveLines(j) {
  const out = jobOutText(j);
  const lines = out ? out.split("\n") : [];
  return JOBOPEN.has(jobKeyOf(j)) ? lines.slice(-200) : lines.slice(-1);
}

// 펼침을 뒤집고 다시 그린다. 열었으면 끝쪽을 따라가는 상태로 시작한다.
function toggleJobCard(key) {
  if (!key) return;
  if (JOBOPEN.has(key)) JOBOPEN.delete(key);
  else { JOBOPEN.add(key); JOBSTICK.set(key, { stick: true, top: 0 }); }
  renderMap(false);
  paintJobScroll();
}

// 렌더 뒤 열린 출력의 스크롤을 되돌린다. 따라가기 중이면 맨 아래를 본다.
function paintJobScroll() {
  for (const p of document.querySelectorAll(".jcard .jout")) {
    const st = JOBSTICK.get(p.dataset.job) || { stick: true };
    p.scrollTop = st.stick ? p.scrollHeight : st.top || 0;
    if (p.__wired) continue;
    p.__wired = true;
    p.addEventListener("scroll", () => {
      JOBSTICK.set(p.dataset.job, { stick: p.scrollTop + p.clientHeight >= p.scrollHeight - 4, top: p.scrollTop });
    });
  }
}
