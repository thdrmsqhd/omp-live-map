/* omp-live-map · view · 로컬·인프라 카드·클러스터 프레임·HOST 지표 카드·지금 하는 일 한 줄 */

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
    <div class="kv" style="margin-top:6px">더블클릭 → 편집기·터미널</div>
    <div class="kv" style="margin-top:2px">우클릭 / Ctrl+N → 새 카드</div>
  </div>`;
}

// 진행 중인 조작의 버튼 글자. wide 는 큰 카드 쪽 긴 문구다.
const PENDING_LABEL = {
  "container-start": "시작 중…", "container-stop": "중지 중…", "container-restart": "재시작 중…",
  "distro-start": "부팅 중…", "distro-stop": "종료 중…", "project-start": "기동 중…",
};
const PENDING_LABEL_WIDE = {
  "distro-start": "WSL 부팅 중…", "distro-stop": "WSL 종료 중…", "project-start": "Compose 기동 중…",
};

// 인프라 카드(압축·큰 카드 공용)의 조작 버튼. 요청이 도는 동안에는 같은 자리에 잠긴 상태 버튼을 둔다.
function infraActions(n, wide) {
  const kind = PENDING.get(n.id);
  if (kind) {
    const label = (wide && PENDING_LABEL_WIDE[kind]) || PENDING_LABEL[kind] || "진행 중…";
    return `<button class="booting" disabled aria-busy="true">${esc(label)}</button>`;
  }
  if (n.kind === "container") {
    const target = n.id.slice(4);
    return n.state === "running"
      ? `<button class="stop" data-act="container-stop" data-t="${esc(target)}">stop</button>
         <button data-act="container-restart" data-t="${esc(target)}">restart</button>`
      : `<button class="go" data-act="container-start" data-t="${esc(target)}">start</button>`;
  }
  if (n.kind === "distro") {
    return n.status === "live"
      ? `<button class="stop" data-act="distro-stop" data-t="${esc(n.name)}">shutdown${wide ? " WSL" : ""}</button>`
      : `<button class="go" data-act="distro-start" data-t="${esc(n.name)}">boot${wide ? " WSL" : ""}</button>`;
  }
  if (n.kind === "project" && n.compose) {
    return `<button class="go" data-act="project-start" data-t="${esc(n.name)}" title="docker compose up -d ${esc(n.name)}">compose up</button>`;
  }
  return "";
}

function infraCard(n, base) {
  const acts = infraActions(n, false);
  if (n.kind === "container") {
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
    ${acts ? `<div class="hd" style="margin-top:5px">${acts}</div>` : ""}
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

// 지도에 남은 작은 카드: 로컬·인프라(세션 에이전트는 큰 카드와 사이드 목록으로만 다룬다).
function plainCard(n) {
  const g = geo.get(n.id);
  const base = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h - 3}px`;
  return n.kind === "local" ? localCard(n, base) : infraCard(n, base);
}

function clusterHTML(c) {
  // 제목 줄을 끌면 클러스터 묶음이 함께 움직인다.
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
  return "";
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
