/* omp-live-map · view · chat 블록 끝에 붙는 마지막 턴 활동(생각·툴·서브에이전트) */

const LIVE_TAIL = 12;   // 접힌 툴 출력에 보이는 줄 수
const LIVE_LABEL = { think: "생각", text: "답변", sub: "서브에이전트", notify: "알림" };
const LIVE_RUNNING = /^(running|live|started|spawned|active|pending|queued)$/i;

function liveItemHTML(it) {
  if (it.kind === "sub") {
    return `<div class="lvitem sub"><span class="lvk">${LIVE_LABEL.sub}</span><span class="lvt">${esc(it.name)}${it.status ? " · " + esc(it.status) : ""}</span></div>`;
  }
  if (it.kind !== "tool") {
    const cls = it.kind === "text" ? "text" : "think";
    return `<div class="lvitem ${cls}"><span class="lvk">${LIVE_LABEL[it.kind] || esc(it.kind)}</span><div class="lvt md">${mdHTML(it.text, it.kind === "text")}</div></div>`;
  }
  if (it.job) {
    return `<div class="lvitem tool job"><div class="lvh"><i class="dot live"></i><span class="lvk">${esc(it.name)}</span>
      <span class="lva">잡 ${esc(it.job)} 띄움 · 출력은 잡 카드</span></div></div>`;
  }
  const args = String(it.args || "").replace(/\s+/g, " ").trim();
  const lines = it.out ? it.out.replace(/\s+$/, "").split("\n") : [];
  const more = lines.length > LIVE_TAIL;
  const shown = it.open || !more ? lines : lines.slice(-LIVE_TAIL);
  const out = !lines.length ? ""
    : `<pre class="lvout${more ? " more" : ""}${it.open ? " open" : ""}" data-lvout="${esc(it.seq)}"${more ? ` title="${it.open ? `눌러서 끝 ${LIVE_TAIL}줄만 보기` : `전체 ${lines.length}줄 · 눌러서 모두 보기`}"` : ""}>${esc(shown.join("\n"))}</pre>`;
  return `<div class="lvitem tool${it.error ? " fail" : ""}">
    <div class="lvh">${it.done ? "" : '<span class="dot live" title="실행 중"></span>'}<span class="lvk">${esc(it.name)}</span>${it.error ? '<span class="lvbad">실패</span>' : it.done ? '<span class="lvok">완료</span>':""}${it.startedAt?`<span class="lvtime">${((it.endedAt||Date.now())-it.startedAt)/1000<1?"<1초":(((it.endedAt||Date.now())-it.startedAt)/1000).toFixed(1)+"초"}</span>`:""}<span class="lva" title="${esc(args)}">${esc(cut(args, 160))}</span></div>
    ${out}
  </div>`;
}

// 마지막 턴의 항목 범위. 도는 중이면 마지막 turn_end 뒤, 끝났으면 그 턴(turn_end 두 개 사이)이다.
// sub(서브 라이프사이클)·notify(알림)는 안내일 뿐이라 turn_end 뒤에 붙어도 도는 중으로 보지 않는다.
const ACT_WORK = (it) => it.kind !== "sub" && it.kind !== "notify";
function actRange(list) {
  let end = -1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === "turn_end") { end = i; break; }
  const tail = list.slice(end + 1);
  if (tail.some(ACT_WORK)) return { items: tail, running: true };
  if (end < 0) return { items: tail, running: false };
  let prev = -1;
  for (let i = end - 1; i >= 0; i--) if (list[i].kind === "turn_end") { prev = i; break; }
  return { items: list.slice(prev + 1, end), running: false };
}

// 글(text) 항목은 도는 중에만 넣는다 — 끝난 턴의 답변은 기록 메시지가 보여준다.
function actItems(nodeId) {
  const { items, running } = actRange(liveItems(nodeId));
  return {
    items: items.filter((it) => (it.kind === "think" || it.kind === "tool" || it.kind === "sub" || it.kind === "notify")
      && (it.kind !== "sub" || !HIDE_DONE_SUBS || !it.status || LIVE_RUNNING.test(it.status))),
    running,
  };
}

function actSummary(items) {
  const tool = items.filter((it) => it.kind === "tool").length;
  const think = items.filter((it) => it.kind === "think").length;
  return [tool ? `도구 ${tool}회` : "", think ? `생각 ${think}` : ""].filter(Boolean).join(" · ");
}

// 대화 목록 끝에 붙는 활동 묶음. 도는 중이면 펼치고, 끝난 턴은 한 줄 요약으로 접는다(펼침은 chatState 에 보관).
function chatActivityHTML(nodeId, st) {
  const { items, running } = actItems(nodeId);
  const history=chatTurnHistory(nodeId);const archive=history.slice(0,running?history.length:-1).filter(x=>x.items.length);const old=archive.length?`<details class="chat-old-activity"><summary>이전 작업 ${archive.length}턴</summary>${archive.map(x=>`<details><summary>${esc(new Date(x.ts).toLocaleTimeString())} · ${esc(actSummary(x.items))}</summary>${x.items.map(liveItemHTML).join("")}</details>`).join("")}</details>`:"";
  if (!items.length) return old;
  const list = items.map(liveItemHTML).join("");
  if(running){const active=items.filter(x=>x.kind==="tool"&&!x.done||x.kind==="sub"&&LIVE_RUNNING.test(x.status||""));const failed=items.filter(x=>x.error);const completed=items.filter(x=>!active.includes(x)&&!failed.includes(x));return old+`<div class="lvact">${active.map(liveItemHTML).join("")}${failed.map(liveItemHTML).join("")}${completed.length?`<details class="chat-activity-done"><summary>이전 활동 ${completed.length}건</summary>${completed.map(liveItemHTML).join("")}</details>`:""}</div>`;}
  const seq = items[items.length - 1].seq;
  if (st.actTurn !== seq) { st.actTurn = seq; st.actOpen = false; }
  const open = !!st.actOpen;
  return old+`<button class="lvsum" data-actsum="1" title="${open ? "활동 접기" : "활동 펼치기"}"><span class="lvk">작업 내역</span><span class="lva">${esc(actSummary(items))}</span><span class="lvcar">${open ? "▴" : "▾"}</span></button>`
    + (open ? `<div class="lvact">${list}</div>` : "");
}
