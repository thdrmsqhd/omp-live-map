/* omp-live-map · viewmodel · 세션 하나 → 배치 블록(카드 절대 좌표·잡·클러스터 테두리) */

function sessionBlock(s, PAD, HEAD) {
  const nodes = sessionNodes(s);
  const hiddenDoneSubs = s.nodes.filter(doneSub).length - nodes.filter(doneSub).length;
  const t = layoutTree(nodes, AG);
  let maxX = t.w;
  const maxY = t.h;
  const ctxParts = nodes.filter((n) => n.ctx && n.ctx.promptTokens)
    .map((n) => ({ id: n.id, name: displayName(n), tok: n.ctx.promptTokens }))
    .sort((a, b) => b.tok - a.tok);
  const ctxTotal = ctxParts.reduce((a, b) => a + b.tok, 0);
  // 열린 카드의 잡은 카드 안 bg 블록이 보여주므로 스테이지 잡 카드에서는 뺀다.
  const appJobs = (s.nodes || []).filter((n) => !openIds.has(n.id)).flatMap((n) => (BGALL.get(n.id) || []))
    .filter(jobVisible)
    .map((j) => ({ id: j.id, cmd: j.cmd, ts: j.startedAt, endedAt: j.endedAt, done: j.done, status: j.code ? "failed" : "completed", tail: j.tail, app: true }));
  // 끝난 잡도 10분은 남긴다(출력 꼬리를 볼 수 있게).
  const jobs = [...appJobs, ...(s.jobs || []).filter(jobVisible)].slice(0, JOB.MAX);
  const jobRows = Math.ceil(jobs.length / JOB.COLS);
  const JOB_DROP = jobs.length ? 34 : 0; // 카드-잡 연결선이 지나갈 간격
  const jobsH = jobs.length ? jobRows * (JOB.H + JOB.GAPY) + 10 + (JOB_DROP - 8) : 0;
  if (jobs.length) maxX = Math.max(maxX, JOB.COLS * JOB.W + (JOB.COLS - 1) * JOB.GAPX);
  const w = Math.max(300, maxX + PAD * 2), h = maxY + PAD * 2 + HEAD + jobsH;
  return {
    kind: "session", key: "0:session:" + s.key, s, w, h,
    place: (x, y) => {
      // 저장 좌표·크기를 먼저 적용하고, 저장값이 없는 카드만 새로 놓는다(전환 전에는 기존 트리 자리).
      const fresh = [];
      for (const [id, p] of t.pos) {
        const m = MANUAL["card:" + id];
        if (m) geo.set(id, { x: m.x, y: m.y, ...cardSize(id) });
        else if (LAYOUT_V2) fresh.push(id);
        else geo.set(id, { x: x + PAD + p.x, y: y + PAD + HEAD + p.y, ...cardSize(id) });
      }
      if (fresh.length) placeFreshCards(fresh, nodes, t.pos, { x: x + PAD, y: y + PAD + HEAD });
      const jobTop = y + PAD + HEAD + maxY + JOB_DROP;
      const c = {
        members: [...t.pos.keys()], allIds: (s.nodes || []).map((n) => n.id), fresh,
        kind: "session", key: s.key, pinned: PINNED.has(s.key),
        x, y, w, h, ox: x, oy: y, fixed: LAYOUT_V2 && !!MANUAL[s.key],
        title: s.title, folder: s.folder, live: s.live, lastTs: s.lastTs,
        agents: nodes.length, hiddenDoneSubs, tokens: s.totals, cost: s.totals.cost,
        ctxTotal, ctxParts,
        jobs: jobs.map((j, i) => ({ ...j, x: x + PAD + (i % JOB.COLS) * (JOB.W + JOB.GAPX), y: jobTop + Math.floor(i / JOB.COLS) * (JOB.H + JOB.GAPY), w: JOB.W, h: JOB.H })),
        jobTotal: jobs.length,
      };
      fitCluster(c);
      CLUSTERS.push(c);
    },
  };
}

