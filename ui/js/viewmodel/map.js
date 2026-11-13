/* omp-live-map · viewmodel · 세션 데이터 → 카드/클러스터 뷰 모델 */
function filteredSessions() {
  const now = Date.now();
  const cut = FILTER === "2h" ? 7200e3 : FILTER === "24h" ? 86400e3 : FILTER === "all" ? Infinity : 0;
  const base = DATA.sessions.filter((s) => (FILTER === "live" ? s.live || now - s.lastTs < 30 * 60e3 : now - s.lastTs <= cut))
    .filter((s) => !HIDDEN.has(s.key) || PINNED.has(s.key) || s.nodes.some((n) => openIds.has(n.id)));
  const keys = new Set(base.map((s) => s.key));
  const keepOpen = DATA.sessions.filter((s) => !keys.has(s.key) && s.nodes.some((n) => openIds.has(n.id)));
  const pinned = DATA.sessions.filter((s) => PINNED.has(s.key) && !keys.has(s.key) && !keepOpen.includes(s));
  return [...keepOpen, ...pinned, ...base];
}

function infraNodes() {
  const nodes = [];
  const running = INFRA.distros.find((d) => d.state.toLowerCase() === "running");
  for (const d of INFRA.distros) {
    nodes.push({ id: "wsl:" + d.name, kind: "distro", name: d.name, parent: null, startedAt: 0,
      status: d.state.toLowerCase() === "running" ? "live" : "idle",
      meta1: "WSL " + d.version, meta2: d.state, image: "" });
  }
  if (!running) return nodes;
  const byProj = new Map();
  for (const c of INFRA.containers || []) {
    if (!byProj.has(c.project)) byProj.set(c.project, []);
    byProj.get(c.project).push(c);
  }
  for (const [proj, list] of byProj) {
    const pid = "proj:" + proj;
    nodes.push({ id: pid, kind: "project", name: proj, parent: "wsl:" + running.name, startedAt: 0,
      status: list.some((c) => c.state === "running") ? "live" : "done",
      meta1: list.filter((c) => c.state === "running").length + "/" + list.length + " up", meta2: "", image: "" });
    for (const c of list) {
      nodes.push({ id: "ctr:" + c.id, kind: "container", name: c.name, parent: pid, startedAt: 0,
        status: c.state === "running" ? "live" : c.state === "exited" ? "done" : "idle",
        meta1: c.image, meta2: c.status, image: c.image, state: c.state, ports: c.ports, command: c.command, service: c.service });
    }
  }
  return nodes;
}

const doneSub = (n) => n.kind === "sub" && n.status !== "live"; // 숨김 대상: live가 아닌 서브(done·idle 등)

function sessionNodes(s) {
  if (!HIDE_DONE_SUBS) return s.nodes;
  return s.nodes.filter((n) => !doneSub(n) || openIds.has(n.id));
}

function agentNodes(sessions) {
  const out = [];
  for (const s of sessions) for (const n of sessionNodes(s)) out.push({ ...n, session: s.key, sessionTitle: s.title });
  return out;
}

// 카드에 보이는 이름: 사용자가 붙인 별칭이 우선한다.
const displayName = (n) => ALIAS.get(n.id) || (n.kind === "main" ? "main" : n.name);

function buildBlocks(sessions) {
  const PAD = 16, HEAD = 62;
  const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  const blocks = [];
  if (SYS) {
    const frame = { w: HOST.W * 4 + HOST.GAPX * 3 + 32, h: HOST.H + HOST.HEAD + 34 };
    blocks.push({ kind: "host", key: "3:host", w: frame.w, h: frame.h,
      place: (x, y) => {
        CLUSTERS.push({ kind: "host", x, y, w: frame.w, h: frame.h, title: "HOST", folder: "이 PC의 리소스",
          live: true, lastTs: Date.now(), agents: 0, cost: 0, jobs: [], jobTotal: 0, tokens: zero() });
      } });
  }
  const inNodes = infraNodes();
  if (inNodes.length) {
    const tmp = new Map();
    const box = layoutInfraInto(inNodes, tmp, 0, 0);
    blocks.push({ kind: "infra", key: "2:infra", w: box.w + PAD * 2, h: box.h + HEAD + PAD * 2,
      place: (x, y) => {
        for (const [k, v] of tmp) geo.set(k, { x: v.x + x + PAD, y: v.y + y + HEAD, w: v.w, h: v.h });
        CLUSTERS.push({ members: [...tmp.keys()], kind: "infra", x, y, w: box.w + PAD * 2, h: box.h + HEAD + PAD * 2,
          title: "WSL · Docker", folder: infraFolder(), live: infraLive(),
          lastTs: Date.now(), agents: 0, tokens: zero(), cost: 0, jobs: [], jobTotal: 0,
          meta: INFRA.distros.map((d) => d.name).join(" · ") + " · " + (INFRA.containers || []).length + " containers" });
      } });
  }
  for (const s of sessions) blocks.push(sessionBlock(s, PAD, HEAD));
  return blocks;
}

// 큰 카드의 블록 영역(.body)은 다시 그려도 DOM 이 유지되므로, 그 안에서 입력 중일 때는 렌더를 미루지 않는다.
const typingNow = () => {
  const a = document.activeElement;
  if (!a || !(a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox"))) return false;
  return !a.closest(".node.big > .body");
};

const SHELL_WORDS = new Set(["cd", "echo", "export", "set", "if", "for", "while", "source", "sudo", "env", "true", "test", "printf"]);

function programs(n) {
  const set = new Set();
  for (const c of n.commands || []) {
    const w = String(c.cmd || "").trim().split(/\s+/)[0].replace(/^["']|["']$/g, "");
    if (!w || SHELL_WORDS.has(w)) continue;
    set.add(w.startsWith("wsl") ? "wsl" : w.split("/").pop());
  }
  if ((n.tools || []).some((t) => t.name === "bash")) set.add("bash");
  return [...set].slice(0, 7);
}

function localNode(L) {
  return {
    id: L.id, kind: "local", name: L.title, cwd: L.cwd, model: "", provider: "",
    status: "idle", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0, requests: 0, series: [], tools: [], commands: [], files: [],
    ctx: null, lastUser: "", lastAssistant: "", startedAt: L.createdAt, lastTs: Date.now(), synthetic: true,
    res: LOCRES.get(L.id) || null,
  };
}

function termState(n) {
  if (!TERM.has(n.id)) {
    TERM.set(n.id, {
      cwd: n.cwd || "",
      lines: [{ t: "# " + (n.cwd || "(기본 폴더)") + " · Git Bash", c: "sys" }],
      draft: "",
    });
  }
  return TERM.get(n.id);
}

function chatState(id) {
  if (!CHAT.has(id)) CHAT.set(id, { draft: "", summary: "", busy: false, log: [], stream: "", files: [] });
  return CHAT.get(id);
}

function subtitleOf(n, isLocal) {
  const main = n.synthetic && !isLocal ? "원본 기록 없음" : (n.title || n.firstUser || (isLocal ? "로컬 작업 카드" : "agent"));
  const extra = String(n.sessionTitle || "").replace(/^[^\w가-힣]+/, "").trim();
  const base = String(main).replace(/^[^\w가-힣]+/, "").trim();
  if (!extra || extra === base) return main;
  return main + " · " + cut(n.sessionTitle, 38);
}

function clusterOfCard(id) {
  return CLUSTERS.find((c) => (c.members || []).includes(id)) || CLUSTERS.find((c) => c.key === id) || null;
}

function sessionKeyOfNode(id) {
  const s = DATA.sessions.find((x) => x.nodes.some((n) => n.id === id));
  return s ? s.key : null;
}

// 큰 카드 하나를 접는다. 다른 열린 카드와 카드별 배치는 건드리지 않는다.
function closeCard(id) {
  if (!id) id = [...openIds].at(-1);
  if (!id) return;
  openIds.delete(id);
  SATS.delete(id);
  saveOpenCards();
}
