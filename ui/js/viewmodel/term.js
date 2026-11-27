/* omp-live-map · viewmodel · 터미널 명령·백그라운드 잡·인프라 조작 */

// 운영 API 토큰은 서버가 index.html 에 심는다. 셸·잡·프로세스·인프라·DB 요청이 모두 이 함수를 지난다.
const OPS_TOKEN = document.querySelector('meta[name="omp-ops-token"]')?.content || "";
const postJSON = (url, body) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Omp-Ops-Token": OPS_TOKEN }, body: JSON.stringify(body),
});

// 세션별 명령 기록. 연속 중복은 한 번만 남기고, ↑↓ 위치는 기록 끝으로 되돌린다.
function pushHist(st, cmd) {
  const h = st.hist || (st.hist = []);
  if (h[h.length - 1] !== cmd) h.push(cmd);
  if (h.length > 100) h.splice(0, h.length - 100);
  st.hi = h.length;
  st.hdraft = "";
}

// 터미널 출력에 줄을 보탠다. 사용자가 방금 친 명령(cmd 줄)이면 하단으로 따라간다.
function termLog(id, lines) {
  const st = TERM.get(id);
  if (!st) return;
  st.lines.push(...lines);
  if (lines.some((l)=>l.c==="cmd")) st.historyOffset=0;
  if (st.lines.length > 300) st.lines = st.lines.slice(-300);
  viewUpdates.term?.(id, lines.some((l) => l.c === "cmd"));
}

async function runTerm(id, cmd) {
  const st = termState(nodeById(id));
  pushHist(st, cmd);
  termLog(id, [{ t: "$ " + cmd, c: "cmd" }]);
  try {
    const res = await postJSON("/api/exec", { cwd: st.cwd, cmd });
    const out = await res.json();
    const lines = [];
    if (out.out) lines.push({ t: out.out.replace(/\r\n/g, "\n").replace(/\n$/, "") });
    if (out.code !== 0) lines.push({ t: `[exit ${out.code}]`, c: "err" });
    const moved = out.cwd && out.cwd !== st.cwd;
    st.cwd = out.cwd || st.cwd;
    termLog(id, lines);
    if (moved) loadTree(id, st.cwd);   // cd 로 옮긴 폴더를 파일 트리도 따라간다
  } catch (err) {
    termLog(id, [{ t: "실행 실패: " + err.message, c: "err" }]);
  }
}

async function startBgJob(id, cwd, cmd) {
  const st = TERM.get(id);
  if (st) pushHist(st, cmd);
  termLog(id, [{ t: "$ (bg) " + cmd, c: "cmd" }]);
  try {
    const res = await postJSON("/api/bg/start", { node: id, cwd, cmd });
    const out = await res.json();
    if (!out.ok) termLog(id, [{ t: "백그라운드 시작 실패: " + (out.out || ""), c: "err" }]);
  } catch (err) {
    termLog(id, [{ t: "백그라운드 시작 실패: " + err.message, c: "err" }]);
  }
  await loadBg(id);
}

async function stopBgJob(nodeId, jobId) {
  try { await postJSON("/api/bg/stop", { id: jobId }); } catch { /* 다음 목록 갱신에서 드러난다 */ }
  loadBg(nodeId);
}

async function loadBg(nodeId) {
  try {
    const res = await fetch("/api/bg/list?node=" + encodeURIComponent(nodeId));
    const data = await res.json();
    // 펼침·스크롤 위치는 클라이언트 상태라 새 목록으로 옮겨 준다.
    const prev = new Map((BGS.get(nodeId) || []).map((j) => [j.id, j]));
    BGS.set(nodeId, (data.jobs || []).map((j) => {
      const p = prev.get(j.id);
      return p ? { ...j, open: p.open, stick: p.stick, top: p.top } : j;
    }));
  } catch { /* ignore */ }
  viewUpdates.bg?.(nodeId);
}

async function loadBgAll() {
  try {
    const res = await fetch("/api/bg/all");
    const data = await res.json();
    const map = new Map();
    for (const j of data.jobs || []) {
      if (!map.has(j.node)) map.set(j.node, []);
      map.get(j.node).push(j);
    }
    const sig = (m) => JSON.stringify([...m.entries()].map(([k, v]) => [k, v.map((j) => [j.id, j.done, (j.tail || []).slice(-1)[0] || ""])]));
    const changed = sig(map) !== sig(BGALL);
    BGALL = map;
    if (changed) viewUpdates.map?.(false);
  } catch { /* ignore */ }
}

// 인프라 조작의 표시 문구. 진행 중인 조작은 state.PENDING(nodeId -> kind)에 남는다.
const INFRA_CMD = {
  "container-start": "docker start", "container-stop": "docker stop", "container-restart": "docker restart",
  "distro-start": "wsl boot", "distro-stop": "wsl shutdown", "project-start": "docker compose up -d",
};
const INFRA_NAME = {
  "container-start": "컨테이너 시작", "container-stop": "컨테이너 중지", "container-restart": "컨테이너 재시작",
  "distro-start": "WSL 부팅", "distro-stop": "WSL 종료", "project-start": "Compose 프로젝트 기동",
};

async function infraAction(kind, target, nodeId) {
  if (nodeId && PENDING.has(nodeId)) return;   // 요청이 도는 동안 같은 카드의 재클릭은 막는다.
  if (kind === "container-stop" || kind === "distro-stop") {
    const what = kind === "distro-stop" ? `WSL '${target}' 전체를 종료` : `컨테이너 ${target.slice(0, 12)} 중지`;
    if (!confirm(`${what}할까요?`)) return;
  }
  if (nodeId) { PENDING.set(nodeId, kind); viewUpdates.map?.(false, true); }
  const log = (lines) => { if (nodeId && openIds.has(nodeId)) termLog(nodeId, lines); };
  try {
    const res = await postJSON("/api/infra/action", { kind, target });
    const out = await res.json();
    const lines = [{ t: `$ ${INFRA_CMD[kind] || kind} ${target.slice(0, 24)}`, c: "cmd" }];
    if (out.out) lines.push({ t: out.out });
    if (!out.ok) {
      lines.push({ t: `[exit ${out.code}]`, c: "err" });
      // 압축 카드에는 터미널이 없으므로 실패는 어느 카드에서 눌렀든 알린다.
      alert(`${INFRA_NAME[kind] || kind} 실패: ${out.out || `exit ${out.code ?? "unknown"}`}`);
    }
    log(lines);
    await loadInfra();
  } catch (err) {
    const msg = `${INFRA_NAME[kind] || kind} 요청 실패: ${err.message}`;
    log([{ t: msg, c: "err" }]);
    alert(msg);
  } finally {
    if (nodeId) { PENDING.delete(nodeId); viewUpdates.map?.(false, true); }
  }
}
