/* omp-live-map · viewmodel · 사이드 세션 목록 행 · 세션 컨텍스트 비중 · 지도에 올라가는 세션 잡 카드 자리 */

const LIST_DONE = new Set();   // 완료 서브를 펼쳐 보기로 한 세션 키(새로고침하면 접힌 상태로 돌아온다)

// 목록에 보일 완료 서브 규칙: 전역 숨김이 꺼져 있거나, 열린 카드이거나, 그 세션만 펼쳤을 때.
const listShows = (n, key) => !doneSub(n) || !HIDE_DONE_SUBS || openIds.has(n.id) || LIST_DONE.has(key);

// 세션 하나의 에이전트를 트리 순서(부모 → 자식, 시작 순)로 늘어놓는다. depth 는 들여쓰기 단계.
function listItems(s) {
  const ids = new Set(s.nodes.map((n) => n.id));
  const kids = new Map();
  for (const n of s.nodes) {
    const p = n.parent && ids.has(n.parent) ? n.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  for (const arr of kids.values()) arr.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  const walk = (n, depth) => {
    if (listShows(n, s.key)) out.push({ n: { ...n, session: s.key, sessionTitle: s.title }, depth: Math.min(depth, 3) });
    for (const c of kids.get(n.id) || []) walk(c, depth + 1);
  };
  for (const root of kids.get(null) || []) walk(root, 0);
  return out;
}

function listRows(sessions) {
  return sessions.map((s) => {
    const items = listItems(s);
    return { s, items, doneTotal: s.nodes.filter(doneSub).length, hidden: s.nodes.length - items.length };
  });
}

// 큰 카드의 "세션 컨텍스트" 막대에 쓰는 에이전트별 컨텍스트 토큰(토큰순).
function ctxPartsOf(sessionKey) {
  const s = GRAPH_SESSIONS.get(sessionKey);
  if (!s) return { parts: [], total: 0 };
  const parts = sessionNodes(s).filter((n) => n.ctx && n.ctx.promptTokens)
    .map((n) => ({ id: n.id, name: displayName(n), tok: n.ctx.promptTokens }))
    .sort((a, b) => b.tok - a.tok);
  return { parts, total: parts.reduce((a, b) => a + b.tok, 0) };
}

// 세션의 잡. 열린 카드의 잡은 카드 안 bg 블록이 보여주므로 뺀다. 기록에서 추정한 잡은 30분 지나면 감춘다(jobLive).
function sessionJobList(s) {
  const app = s.nodes.filter((n) => !openIds.has(n.id))
    .flatMap((n) => (BGALL.get(n.id) || []).filter(jobVisible)
      .map((j) => ({ id: j.id, cmd: j.cmd, ts: j.startedAt, endedAt: j.endedAt, done: j.done, status: j.code ? "failed" : "completed", tail: j.tail, app: true, file: n.id })));
  return [...app, ...(s.jobs || []).filter(jobLive)].slice(0, JOB.MAX);
}

// 지도의 잡 카드: 세션에 열린 큰 카드가 있을 때만 그 카드(잡을 띄운 카드, 없으면 메인) 아래에 쌓는다.
// 열린 큰 카드가 없는 세션의 잡은 지도에 올리지 않는다(앵커가 없다).
function sessionJobs(sessions) {
  const out = [];
  for (const s of sessions) {
    const open = s.nodes.filter((n) => SATS.has(n.id));
    if (!open.length) continue;
    const main = open.find((n) => n.kind === "main") || open[0];
    const rows = new Map();   // 앵커 id -> 잡 목록
    for (const j of sessionJobList(s)) {
      const owner = (open.find((n) => n.id === j.file) || main).id;
      if (!rows.has(owner)) rows.set(owner, []);
      rows.get(owner).push({ ...j, owner });
    }
    for (const [owner, list] of rows) {
      const b = SATS.get(owner);
      let y = b.y + b.h + 24;
      for (let i = 0; i < list.length; i += JOB.COLS) {
        const row = list.slice(i, i + JOB.COLS);
        const h = row.some((j) => JOBOPEN.has(jobKeyOf(j))) ? JOB.OPENH : JOB.H;
        row.forEach((j, c) => out.push({ ...j, x: b.x + c * (JOB.W + JOB.GAPX), y, w: JOB.W, h: JOB.H }));
        y += h + JOB.GAPY;
      }
    }
  }
  return out;
}
