/* omp-live-map · view · 압축 카드·미러 카드·클러스터 프레임·HOST 지표 카드 */

// 큰 카드로 열린 동안 원래 자리에 남는 미러: 상태 점·이름·"열림"만 둔다(수치는 큰 카드에 있다).
function ghostCard(n) {
  const g = geo.get(n.id);
  const name = agentKind(n.kind) ? displayName(n) : n.name;
  return `<div class="node ghost ${n.kind} ${n.status}" data-ghost="${esc(n.id)}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h - 3}px">
    <div class="hd"><i class="dot ${n.status}"></i><span class="nm">${esc(name)}</span><span class="mod">열림</span></div></div>`;
}

function ctxChip(n) {
  const u = ctxUsage(n);
  return u ? `<span class="ctxp ${u.level}" title="컨텍스트 ${fmt(n.ctx.promptTokens)} / ${fmt(n.ctxWindow)} tok">ctx ${u.text}</span>` : "";
}

function localCard(n, base) {
  const st = TERM.get(n.id);
  return `<div class="node local live" data-id="${esc(n.id)}" style="${base}">
    <div class="hd"><i class="dot idle"></i>
      ${renamingId === n.id
        ? `<input class="rename" data-id="${esc(n.id)}" value="${esc(n.name)}">`
        : `<span class="nm">${esc(n.name)}</span>`}
      <button class="x" data-rename="${esc(n.id)}" title="이름 변경" style="padding:0 4px">✎</button>
      <button class="x" data-del="${esc(n.id)}" title="카드 삭제" style="padding:0 4px">🗑</button>
      <span class="mod">local</span></div>
    <div class="sub-t">${esc(st ? st.cwd : n.cwd)}</div>
    ${resRow(n, false)}
    <div class="kv" style="margin-top:6px">더블클릭 → 터미널·파일</div>
    <div class="kv" style="margin-top:2px">우클릭 / Ctrl+N → 새 카드</div>
  </div>`;
}

function infraCard(n, base) {
  if (n.kind === "container") {
    const acts = n.state === "running"
      ? `<button class="stop" data-act="container-stop" data-t="${esc(n.id.slice(4))}">stop</button>
         <button data-act="container-restart" data-t="${esc(n.id.slice(4))}">restart</button>`
      : `<button class="go" data-act="container-start" data-t="${esc(n.id.slice(4))}">start</button>`;
    return `<div class="node container ${n.status}" data-id="${esc(n.id)}" style="${base}">
      <div class="hd"><i class="dot ${n.status}"></i><span class="nm">${esc(n.name)}</span></div>
      <div class="sub-t" style="margin-top:1px">${esc(modelShort(n.image))}</div>
      <div class="kv" style="margin-top:2px">${esc(n.meta2 || "")}</div>
      <div class="hd" style="margin-top:9px;gap:5px">${acts}</div>
    </div>`;
  }
  return `<div class="node ${n.kind} ${n.status}" data-id="${esc(n.id)}" style="${base}">
    <div class="hd"><i class="dot ${n.status}"></i><span class="nm">${esc(n.name)}</span></div>
    <div class="sub-t" style="margin-top:1px">${esc(n.meta1)}</div>
    <div class="kv" style="margin-top:2px">${esc(n.meta2)}</div>
    ${n.kind === "distro" ? `<div class="hd" style="margin-top:5px">${n.status === "live"
      ? `<button class="stop" data-act="distro-stop" data-t="${esc(n.name)}">shutdown</button>`
      : `<button class="go" data-act="distro-start" data-t="${esc(n.name)}">boot</button>`}</div>` : ""}
  </div>`;
}

// 지금 도는 툴 한 줄: 이름 · 인자 · 경과 · 마지막 출력. 카드가 작아도 이 줄은 항상 보인다.
function nowLine(n) {
  const a = (n.active || [])[0];
  if (!a) return "";
  const out = typeof liveOutText === "function" ? liveOutText(n.id, a.id) : "";
  const last = out ? out.replace(/\s+$/, "").split("\n").pop() : "";
  return `<div class="nowline" title="${esc(a.args || "")}">
    <i class="dot live"></i><b>${esc(a.name || "?")}</b>
    <span class="nwa">${esc(cut(a.args || "", 40))}</span>
    <span class="nwd">${dur(Date.now() - (a.ts || Date.now()))}</span>
    ${last ? `<span class="nwo">${esc(cut(last, 48))}</span>` : ""}</div>`;
}

function smallCard(n) {
  const g = geo.get(n.id);
  const base = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h - 3}px`;
  if (n.kind === "local") return localCard(n, base);
  if (!agentKind(n.kind)) return infraCard(n, base);
  const subText = n.synthetic ? "원본 기록 없음" : (n.title || n.firstUser || (n.kind === "main" ? "main agent" : "subagent"));
  const sum = tokTotal(n.tokens);
  const prof = profileChip(n); // 좁은 카드라 프로필이 있으면 모델 글자 대신 칩을 둔다(모델은 칩 title 에).
  return `<div class="node ${n.kind} ${n.status}${SUBSIZE.has(n.id) ? " sized" : ""}" data-id="${esc(n.id)}" style="${base}">
    <div class="hd session-hd"><i class="dot ${n.status}" title="${esc(dotTitle(n))}"></i><span class="nm">${esc(displayName(n))}</span>
      ${ctxChip(n)}${prof || `<span class="mod" title="${esc(n.provider ? n.provider + " · " : "")}${esc(n.model || "?")}">${esc(modelShort(n.model))}</span>`}<button class="x danger session-close" data-dismiss="1" title="세션 종료 · 리소스 정리 · 카드 제거">닫기</button></div>
    <div class="sub-t" title="${esc(subText)}">${esc(subText)}</div>
    ${nowLine(n)}
    <div class="ibar">${tokenTape(n.tokens)}</div>
    <div class="nums">
      <u class="m-tok" title="입력 ${fmt(n.tokens.input)} tok · 전체의 ${pctText(n.tokens.input, sum)}">in <b>${fmt(n.tokens.input)}</b></u>
      <u class="m-out" title="출력 ${fmt(n.tokens.output)} tok · 전체의 ${pctText(n.tokens.output, sum)}">out <b>${fmt(n.tokens.output)}</b></u>
      <u class="m-cache" title="캐시 읽기 ${fmt(n.tokens.cacheRead)} tok · 전체의 ${pctText(n.tokens.cacheRead, sum)}">cache <b>${fmt(n.tokens.cacheRead)}</b></u>
      <u class="m-req" style="margin-left:auto" title="요청 ${n.requests}회 · 턴 ${n.turns || 0} · 평균 TTFT ${n.avgTtft || 0}ms">req <b>${n.requests}</b></u>
    </div>
    <div class="sparkwrap">
      <span class="rate">${n.liveTokPerSec ? n.liveTokPerSec.toFixed(1) : "0"} t/s</span>
      ${spark(n.series || [], 208, 24, "#2fbf9b", true)}
    </div>
    ${resRow(n, false)}
    ${n.kind === "sub" ? resizeGrip() : ""}
  </div>`;
}

function clusterHTML(c) {
  // 제목 줄을 끌면 클러스터 묶음이 함께 움직인다(카드를 끌면 그 카드만).
  const frame = (cls, inner) => `<div class="cluster ${cls}" data-ckey="${esc(clusterKeyOf(c))}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">${inner.replace('<div class="ch">', '<div class="ch" title="끌어서 묶음 이동">')}</div>`;
  if (c.kind === "host") {
    return frame("live", `<div class="ch"><div class="r1"><span class="ct">${esc(c.title)}</span><span class="cm">${esc(c.folder)}</span></div></div>`);
  }
  if (c.kind === "infra") {
    return frame(c.live ? "live" : "", `<div class="ch"><div class="r1"><span class="ct">${esc(c.title)}</span><span class="cm">${esc(c.meta || "")}</span></div>
      <div class="r2"><span class="cd">${esc(c.folder)}</span><span class="ca">${c.live ? "running" : "idle"}</span></div></div>`);
  }
  if (c.kind === "local") {
    return frame("live", `<div class="ch"><div class="r1"><span class="ct">${esc(c.title)}</span></div>
      <div class="r2"><span class="cd">${esc(c.folder || "")}</span><span class="ca">local</span></div></div>`);
  }
  return frame(c.live ? "live" : "", `<div class="ch">
      <div class="r1"><span class="ct">${esc(c.title)}</span>
        ${c.pinned ? `<button class="unpin" data-unpin="${esc(encodeURIComponent(c.key || ""))}" style="padding:0 5px;font-size:9.5px">고정됨 ✕</button>` : ""}
        ${c.agents + (c.hiddenDoneSubs || 0) > 1 ? `<span class="cm"><span class="m-tok">${fmt(c.tokens.tokens)} tok</span> · <span class="m-cost">${krw(c.cost)}</span></span>` : ""}</div>
      <div class="r2"><span class="cd">${esc(c.folder)}</span>
        <span class="ca">${c.ctxTotal && c.agents > 1 ? "ctx " + fmt(c.ctxTotal) + " · " : ""}${c.agents} agent${c.hiddenDoneSubs ? ` · 완료 ${c.hiddenDoneSubs} 숨김` : ""} · ${c.jobTotal ? c.jobTotal + " job · " : ""}${ago(c.lastTs)}</span></div>
    </div>
    <div class="ctape">${tokenTape(c.tokens)}</div>
    ${(c.jobs || []).map((j) => jobCard(j, c)).join("")}`);
}

// HOST 클러스터 안의 지표 카드. 조각(piece)은 루트 엘리먼트가 하나여야 하므로 카드마다 따로 돌려준다.
function hostCards() {
  const hc = CLUSTERS.find((c) => c.kind === "host");
  if (!SYS || !hc) return [];
  const level = (pct, warn, err, ok) => (pct > err ? "#e3564f" : pct > warn ? "#e0a83c" : ok);
  const m = SYS.mem;
  const gb = (mb) => (mb / 1024).toFixed(1);
  const items = [
    { k: "RAM", v: `${gb(m.usedMB)} / ${gb(m.totalMB)} GB`, pct: m.usedPct, sub: `여유 ${gb(m.freeMB)} GB`, c: level(m.usedPct, 65, 85, "#2fbf9b") },
    { k: "CPU", v: SYS.cpu.pct + "%", pct: SYS.cpu.pct, sub: SYS.cpu.cores + " cores", c: level(SYS.cpu.pct, 60, 85, "#4aa8ff") },
  ];
  if (SYS.disk) items.push({ k: "DISK C:", v: SYS.disk.freeGB + " GB free", pct: SYS.disk.usedPct, sub: `사용 ${SYS.disk.usedPct}% / ${SYS.disk.totalGB} GB`, c: level(SYS.disk.usedPct, 75, 90, "#a98bff") });
  items.push({ k: "UPTIME", v: `${Math.floor(SYS.uptimeSec / 3600)} h ${Math.floor((SYS.uptimeSec % 3600) / 60)} m`, pct: 100, sub: "since boot", c: "#5c7186" });
  return items.map((it, i) => ({
    key: "host:" + it.k,
    html: `<div class="node metric live" data-metric="1" style="left:${hc.x + 16 + i * (HOST.W + HOST.GAPX)}px;top:${hc.y + HOST.HEAD + 8}px;width:${HOST.W}px;height:${HOST.H}px">
      <div class="hd"><span class="nm">${it.k}</span></div>
      <div class="mv">${esc(it.v)}</div>
      <div class="ibar" style="margin-top:6px"><i style="width:${Math.max(2, Math.min(100, it.pct))}%;background:${it.c}"></i></div>
      <div class="kv" style="margin-top:5px">${esc(it.sub)}</div>
    </div>`,
  }));
}
