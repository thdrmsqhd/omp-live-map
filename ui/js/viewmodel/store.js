/* omp-live-map · viewmodel · 서버 스냅샷·인프라·호스트 상태 수신 */

// 스냅샷을 상태에 넣는다. 서버가 변화가 있을 때만 보내므로 받은 대로 그린다.
function setGraph(data) {
  DATA = data;
  GRAPH_SESSIONS = new Map();
  GRAPH_NODES = new Map();
  for (const session of data.sessions) {
    GRAPH_SESSIONS.set(session.key, session);
    for (const node of session.nodes) if (!GRAPH_NODES.has(node.id)) GRAPH_NODES.set(node.id, { node, session });
  }
  if (data.fx && data.fx.usdKrw) FX = data.fx.usdKrw;
  if (data.env) ENV = data.env;
}

function apply(data, patch) {
  const previous = DATA;
  setGraph(data);
  if (!patch || !renderGraphPatch(previous, patch)) renderMap(false);
}

// 스냅샷을 지금 다시 받는다(새 세션 파일처럼 SSE 방송을 기다리지 않을 때).
async function reloadGraph() {
  try {
    const res = await fetch("/api/graph");
    if (res.ok) setGraph(await res.json());
  } catch { /* 서버 재시작 중 */ }
}

async function fetchInfra() {
  const res = await fetch("/api/infra");
  const data = await res.json();
  const sig = (v) => JSON.stringify((v.containers || []).map((c) => [c.id, c.state]).concat((v.distros || []).map((d) => [d.name, d.state]), (v.projects || []).map((p) => [p.name, p.compose])));
  const changed = sig(data) !== sig(INFRA);
  INFRA = { distros: [], containers: [], projects: [], ...data };
  return changed;
}

async function loadInfra() {
  try { if (await fetchInfra()) renderMap(false); } catch { /* server restarting */ }
}

async function fetchSys() {
  const res = await fetch("/api/sys");
  const next = await res.json();
  const sig = (v) => (v ? v.mem.usedPct + ":" + v.cpu.pct + ":" + (v.disk ? v.disk.freeGB : "") : "");
  const changed = sig(SYS) !== sig(next);
  SYS = next;
  return changed;
}

async function loadSys() {
  try { if (await fetchSys()) renderMap(false); } catch { /* server restarting */ }
}
