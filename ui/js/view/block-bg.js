/* omp-live-map · view · bg 블록 (이 카드에서 띄운 백그라운드 잡) */

function bgHTML(nodeId) {
  const jobs = (BGS.get(nodeId) || []).filter(jobVisible);
  return `<div class="bgs">${jobs.map((j) => {
    const lines = j.lines || [];
    const fail = j.done && j.code != null && j.code !== 0;
    const shown = j.open ? lines : lines.slice(-3);
    return `<div class="bgitem${fail ? " fail" : ""}">
    <div class="bgh"><span class="id">${esc(j.id)}</span>
      ${fail ? '<span class="bad">오류</span>' : ""}
      <span class="st ${j.done ? "done" : ""}">${j.done ? "종료 " + (fail ? `<b class="code">${esc(j.code)}</b>` : esc(j.code ?? "")) : "실행 중"}</span>
      <span class="c" title="${esc(j.cmd)}">${esc(cut(j.cmd, 60))}</span>
      ${lines.length > 3 ? `<button data-bgtog="${esc(j.id)}">${j.open ? "접기" : "펼치기"}</button>` : ""}
      ${j.done ? "" : `<button data-stopbg="${esc(j.id)}">stop</button>`}
    </div>
    <pre class="bgout${j.open ? " open" : ""}" data-job="${esc(j.id)}">${shown.map((l) => `<span class="${l.c || ""}">${esc(l.t)}</span>`).join("\n")}</pre>
  </div>`;
  }).join("")}</div>`;
}

// 잡 목록을 다시 그린다. 보일 잡이 없으면 블록을 통째로 숨긴다(바디 구성은 그대로).
function paintBg(nodeId) {
  const el = ELS.get(nodeId);
  const holder = el && el.querySelector(".bgslot");
  if (!holder) return;
  const jobs = BGS.get(nodeId) || [];
  holder.closest(".blk").hidden = !jobs.some(jobVisible);
  const html = bgHTML(nodeId);
  if (holder.__html === html) return;
  holder.__html = html;
  const prev = holder.querySelector(".bgs");
  const listTop = prev ? prev.scrollTop : 0;
  holder.innerHTML = html;
  holder.querySelector(".bgs").scrollTop = listTop;
  // 사용자가 위로 올려 둔 출력은 하단으로 끌어내리지 않는다.
  holder.querySelectorAll(".bgout").forEach((p) => {
    const j = jobs.find((x) => x.id === p.dataset.job);
    p.scrollTop = !j || j.stick !== false ? p.scrollHeight : (j.top || 0);
  });
}

function mountBg(box, n) {
  const nodeId = n.id;
  const holder = box.querySelector(".bgslot");
  const job = (id) => (BGS.get(nodeId) || []).find((j) => j.id === id);
  holder.addEventListener("click", (e) => {
    const tog = e.target.closest("button[data-bgtog]");
    if (tog) {
      const j = job(tog.dataset.bgtog);
      if (j) { j.open = !j.open; paintBg(nodeId); }
      return;
    }
    const stop = e.target.closest("button[data-stopbg]");
    if (stop) stopBgJob(nodeId, stop.dataset.stopbg);
  });
  holder.addEventListener("scroll", (e) => {
    const p = e.target;
    if (!p.classList || !p.classList.contains("bgout")) return;
    const j = job(p.dataset.job);
    if (!j) return;
    j.stick = p.scrollTop + p.clientHeight >= p.scrollHeight - 4;
    j.top = p.scrollTop;
  }, true);
  paintBg(nodeId);
}

registerBlock({
  type: "bg",
  slot: "main",
  flex: "0 0 auto",
  render: () => '<div class="bgslot"></div>',
  mount: mountBg,
});
