// 세션 소유 프로세스: omp 본체 프로세스를 세션(메인 파일 상태)에 1:1로 연결한다.
"use strict";

const BEFORE_MS = 15_000; // 프로세스 생성이 세션 시작보다 최대 15초 앞설 수 있다.
const AFTER_MS = 3_000; // 또는 최대 3초 늦을 수 있다.

const norm = (s) => String(s || "").toLowerCase().replace(/\\/g, "/");

// 이름이 omp(.exe)이고 __omp_worker가 아닌 프로세스 = omp 본체.
function isOmpMain(p) {
  return /^omp(\.exe)?$/i.test(p.name || "") && !String(p.cmd || "").includes("__omp_worker");
}

// (a) 명령줄에 세션 파일 경로 또는 세션 id(8자 이상 접두사 포함)가 있다.
function cmdMatches(p, st) {
  const cmd = norm(p.cmd);
  if (cmd.includes(norm(st.file))) return true;
  const id = norm(st.id);
  if (id.length < 8) return false;
  if (cmd.includes(id)) return true;
  return cmd.split(/[\s"'=]+/).some((t) => t.length >= 8 && id.startsWith(t));
}

// mains: 메인 파일 상태들, procs: PROC.list. 반환: Map(메인 파일 경로 -> pid).
// 명령줄 일치(a)를 먼저 배정하고, 남은 프로세스는 시각 차(b)가 작은 짝부터 배정해 한 pid가 두 세션에 붙지 않게 한다.
function assignOwners(mains, procs) {
  const omps = procs.filter(isOmpMain);
  const owners = new Map();
  const taken = new Set();
  const pending = [];
  for (const st of mains) {
    const hit = omps.find((p) => !taken.has(p.pid) && cmdMatches(p, st));
    if (hit) {
      owners.set(st.file, hit.pid);
      taken.add(hit.pid);
    } else if (st.startedAt) {
      pending.push(st);
    }
  }
  const pairs = [];
  for (const st of pending) {
    for (const p of omps) {
      if (taken.has(p.pid) || !p.start) continue;
      const lead = st.startedAt - p.start; // 양수: 프로세스가 먼저 생성됨
      if (lead <= BEFORE_MS && lead >= -AFTER_MS) pairs.push({ st, pid: p.pid, diff: Math.abs(lead) });
    }
  }
  pairs.sort((a, b) => a.diff - b.diff);
  for (const { st, pid } of pairs) {
    if (owners.has(st.file) || taken.has(pid)) continue;
    owners.set(st.file, pid);
    taken.add(pid);
  }
  return owners;
}

module.exports = { assignOwners, isOmpMain };
