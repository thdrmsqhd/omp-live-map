// 프로세스 관측: Win32 프로세스 목록(PROC)·세션 소유 프로세스·노드별 프로세스 귀속·자원 이력 소유, CPU% 계산.
"use strict";

const os = require("os");
const { spawn } = require("child_process");
const { bgJobs } = require("./shell");
const { allStates, stateOf } = require("./tail");
const { assignOwners } = require("./owner");
const { attribute } = require("./attrib");

let PROC = { at: 0, list: [], loading: false, error: null, prev: new Map(), atWall: 0 };
const CORES = Math.max(1, os.cpus().length);
const HIST_N = 10; // 노드별 자원 표본 수(4초 주기 ≈ 40초)
const QUIET_MS = 30 * 60_000;
const hist = new Map(); // file -> [{cpu, mb}] 오래된 것부터
let byPid=new Map();
let owners = new Map(); // 메인 파일 경로 -> omp 본체 pid
let claims = new Map(); // 노드 파일 -> Set(pid), 노드끼리 겹치지 않는다(server/attrib.js)

function readProcs() {
  return new Promise((resolve) => {
    const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -notmatch '^(System|Registry|smss|csrss|wininit|services|lsass|svchost|dwm|explorer|SearchIndexer)$' } | " +
      "Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,UserModeTime,KernelModeTime,CommandLine," +
      "@{n='Start';e={if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }}} | ConvertTo-Json -Compress";
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let out = "", done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(out); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(); }, 25000);
    child.stdout.on("data", d=>{out+=d;if(out.length>8*1024*1024){try{child.kill();}catch{}out="";finish();}});
    child.stderr.on("data", () => {});
    child.on("close", finish);
    child.on("error", finish);
  });
}

async function refreshProc() {
  if (PROC.loading) return;
  PROC.loading = true;
  try {
    const raw = await readProcs();
    const start = raw.indexOf("[");
    const obj = raw.indexOf("{");
    const from = start >= 0 && (obj < 0 || start < obj) ? start : obj;
    let arr = [];
    if (from >= 0) {
      const parsed = JSON.parse(raw.slice(from, raw.lastIndexOf("]") >= 0 ? raw.lastIndexOf("]") + 1 : raw.lastIndexOf("}") + 1));
      arr = Array.isArray(parsed) ? parsed : [parsed];
    }
    const now = Date.now();
    const dt = PROC.atWall ? Math.max(200, now - PROC.atWall) : 0;
    const next = new Map();
    PROC.list = arr.map((p) => {
      const cpuMs = Math.round(((p.UserModeTime || 0) + (p.KernelModeTime || 0)) / 10000);
      const prevCpu = PROC.prev.get(p.ProcessId);
      let cpuPct = 0;
      if (dt && prevCpu != null) cpuPct = Math.max(0, Math.min(100, ((cpuMs - prevCpu) / dt / CORES) * 100));
      next.set(p.ProcessId, cpuMs);
      return { pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, mb: Math.round((p.WorkingSetSize || 0) / 1048576), cpu: +cpuPct.toFixed(1),
        cmd: String(p.CommandLine || "").slice(0, 500), start: Number(p.Start) || 0 };
    });
    byPid=new Map(PROC.list.map(p=>[p.pid,p]));
    PROC.prev = next;
    PROC.atWall = now;
    PROC.at = now;
    PROC.error = null;
    const states = [...allStates()];
    owners = assignOwners(states.filter((st) => st.depth === 2), PROC.list);
    claims = attribute(PROC.list, owners, states, bgJobs());
  } catch (exc) {
    PROC.error = String(exc).slice(0, 160);
    PROC.at = Date.now();
  }
  PROC.loading = false;
  sampleHist();
}

// 최근 30분 안에 활동한 노드의 자원 표본을 링 버퍼에 쌓고, 조용한 노드의 버퍼는 지운다.
function sampleHist() {
  const now = Date.now();
  for (const st of allStates()) {
    const last = st.lastTs || st.startedAt;
    if (!last || now - last > QUIET_MS) {
      hist.delete(st.file);
      continue;
    }
    const r = resFor(st.file);
    const buf = hist.get(st.file) || [];
    buf.push({ cpu: r.cpu, mb: r.mb });
    if (buf.length > HIST_N) buf.shift();
    hist.set(st.file, buf);
  }
}

function histOf(file) {
  return (hist.get(file) || []).map((x) => x.cpu);
}

// 강제 재조회(프로세스 정리 직후): 마지막 갱신 시각을 무효화하고 다시 읽는다.
function reloadProc() {
  PROC.at = 0;
  return refreshProc();
}

// 노드의 소유 omp 본체 pid(세션 메인 기준, 서브에이전트도 공유). 없으면 0.
function ownerOf(nodeId) {
  const st = stateOf(nodeId);
  return (st && owners.get(st.mainFile)) || 0;
}

// 노드에 귀속된 프로세스의 자원 합(server/attrib.js 가 나눈 몫). 세션 메인 노드는 omp 본체를 포함하고,
// 서브에이전트 노드는 지금 자기 bash 명령이 띄운 프로세스만 갖는다. owner 는 세션의 omp 본체 pid(서브도 공유).
function resFor(nodeId) {
  const pids = claims.get(nodeId) || new Set();
  let cpu = 0, mb = 0, n = 0;
  const procs = [];
  for (const pid of pids) {
    const p=byPid.get(pid);if(!p)continue;
    cpu += p.cpu;
    mb += p.mb;
    n += 1;
    procs.push({ pid: p.pid, name: p.name, cpu: p.cpu, mb: p.mb });
  }
  procs.sort((a, b) => b.mb - a.mb);
  const st = stateOf(nodeId);
  return { cpu: +cpu.toFixed(1), mb, proc: n, procs: procs.slice(0, 6), all: [...pids].slice(0, 200),
    owner: String(nodeId || "").startsWith("local_") ? 0 : ownerOf(nodeId), main: !!st && st.depth === 2 };
}

// 맵이 이 노드에서 띄운 백그라운드 잡과 그 자식만 정리한다.
// 작업 폴더가 같다는 이유만으로 다른 터미널이나 세션을 종료하지 않는다.
function releaseSet(nodeId) {
  const pids = new Set();
  for (const j of bgJobs()) if (j.node === nodeId && !j.done && j.proc && j.proc.pid) pids.add(j.proc.pid);
  const kids = new Map();
  for (const p of PROC.list) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  const queue = [...pids];
  while (queue.length) {
    const pid = queue.pop();
    for (const child of kids.get(pid) || []) if (!pids.has(child)) { pids.add(child); queue.push(child); }
  }
  let mb = 0;
  for (const p of PROC.list) if (pids.has(p.pid)) mb += p.mb;
  return { mb, all: [...pids].slice(0, 200) };
}

function procState() {
  return { at: PROC.at, error: PROC.error, procs: PROC.list };
}

function findProc(pid) {
  return byPid.get(pid) || null;
}

module.exports = { refreshProc, reloadProc, resFor, releaseSet, histOf, procState, findProc };
