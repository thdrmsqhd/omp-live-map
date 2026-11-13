// 프로세스 귀속: 프로세스 목록을 노드(세션 기록 파일)별로 겹치지 않게 나눈다. 상태 없음(proc.js 가 결과를 들고 있다).
// 서브에이전트는 omp 본체 안에서 돌아 본체 CPU·메모리를 나눌 수 없다. 대신 본체의 자식 프로세스(툴이 띄운 bash·node 등)를
// 지금 그 명령을 돌리는 노드에 붙이고, 본체와 나머지 자식은 세션 메인 노드에 붙인다.
"use strict";

const norm = (s) => String(s || "").toLowerCase().replace(/\\/g, "/");

// 자식 프로세스 명령줄 토큰 중 노드의 실행 중 bash 명령에 들어 있는 비율(0~1).
function cmdScore(cmd, text) {
  const toks = norm(cmd).split(/[\s"']+/).filter(Boolean);
  if (!toks.length || !text) return 0;
  toks[0] = toks[0].split("/").pop().replace(/\.exe$/, "");
  const keep = toks.filter((t, i) => i === 0 || t.length >= 3);
  const hits = keep.filter((t) => text.includes(t)).length;
  return keep.length > 1 && hits < 2 ? 0 : hits / keep.length;
}

// 노드별 실행 중 bash 명령(정규화). states: 같은 세션의 파일 상태들.
function runningCmds(states) {
  const out = [];
  for (const st of states) {
    if (!st.active) continue;
    for (const a of st.active.values()) {
      if (a.name !== "bash") continue;
      const text = norm((st.toolCmds && st.toolCmds.get(a.id)) || a.args);
      if (text) out.push({ file: st.file, text });
    }
  }
  return out;
}

// procs: PROC.list, owners: Map(메인 파일 -> omp pid), states: 전체 파일 상태, jobs: 맵이 띄운 잡.
// 반환: Map(노드 파일 -> Set(pid)). 한 pid 는 한 노드에만 들어간다.
function attribute(procs, owners, states, jobs) {
  const kids = new Map();
  for (const p of procs) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  const claims = new Map();
  const taken = new Set();
  const give = (file, pid) => {
    if (!claims.has(file)) claims.set(file, new Set());
    const set = claims.get(file);
    const queue = [pid];
    while (queue.length) {
      const id = queue.pop();
      if (taken.has(id)) continue;
      taken.add(id);
      set.add(id);
      for (const c of kids.get(id) || []) queue.push(c.pid);
    }
  };
  for (const j of jobs) if (!j.done && j.proc && j.proc.pid) give(j.node, j.proc.pid);
  for (const [mainFile, pid] of owners) {
    const cmds = runningCmds(states.filter((st) => st.mainFile === mainFile));
    taken.add(pid);
    if (!claims.has(mainFile)) claims.set(mainFile, new Set());
    claims.get(mainFile).add(pid);
    for (const child of kids.get(pid) || []) {
      let best = null, top = 0.5;
      for (const c of cmds) {
        const s = cmdScore(child.cmd, c.text);
        if (s >= top) { best = c.file; top = s; }
      }
      give(best || mainFile, child.pid);
    }
  }
  return claims;
}

module.exports = { attribute, cmdScore };
