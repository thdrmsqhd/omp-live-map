"use strict";

// 데스크톱 앱을 검증용으로 띄우고 디버그(CDP) 주소를 돌려준다. 사용자의 화면을 건드리지 않는다:
//  - 저장소 실행: Electron + tests/verification/offscreen(창 화면 밖·포커스 불가·작업 표시줄 없음). OMP_VERIFY_LAUNCHER 로 같은 모양의
//    다른 런처 폴더(package.json + launch.cjs, OLM_CDP_PORT 로 디버그 포트)를 줄 수 있다. Electron 경로는 OMP_ELECTRON 또는 require("electron").
//  - 설치본(OMP_MAP_INSTALLED_EXE, CI 설치 검증): 그대로 실행하고 --remote-debugging-port 만 준다.
// 기록·상태는 userDataDir 아래 임시 폴더만 쓰고(~/.omp · ~/.claude 를 읽지도 쓰지도 않는다), 끝낼 때는 자기가 띄운 프로세스 트리만 끝낸다.
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function launchDesktop({ userDataDir, args = [], env = {} }) {
  const port = await freePort();
  const installed = process.env.OMP_MAP_INSTALLED_EXE;
  const launcher = process.env.OMP_VERIFY_LAUNCHER || path.join(__dirname, "offscreen");
  const command = installed || process.env.OMP_ELECTRON || require("electron");
  const home = path.join(userDataDir, "verify-home");
  for (const dir of ["sessions", "claude"]) fs.mkdirSync(path.join(home, dir), { recursive: true });
  const argv = [...(installed ? ["--remote-debugging-port=" + port] : [launcher]), "--user-data-dir=" + userDataDir, ...args];
  const proc = spawn(command, argv, {
    env: { ...process.env, OLM_CDP_PORT: String(port), OMP_MAP_STATE: path.join(home, "state"),
      OMP_MAP_SESSIONS: path.join(home, "sessions"), OMP_MAP_CLAUDE_PROJECTS: path.join(home, "claude"), ...env },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  const keep = (chunk) => { output = (output + chunk.toString()).slice(-8000); };
  proc.stdout.on("data", keep);
  proc.stderr.on("data", keep);
  const closed = once(proc, "close");
  closed.catch(() => {});
  const endpoint = "http://127.0.0.1:" + port;
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      // 자기가 띄운 Electron 과 그 자식(로컬 서버·렌더러)만 끝낸다.
      if (process.platform === "win32") { try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch { proc.kill(); } }
      else proc.kill();
    }
    await closed.catch(() => {});
  };
  for (const deadline = Date.now() + 30000; ;) {
    try { if ((await fetch(endpoint + "/json/version")).ok) break; } catch { /* 아직 */ }
    if (proc.exitCode !== null) throw new Error("Desktop exited " + proc.exitCode + ": " + output);
    if (Date.now() > deadline) { await stop(); throw new Error("Desktop did not expose its test port: " + output); }
    await sleep(250);
  }
  return { proc, endpoint, closed, stop, output: () => output };
}

module.exports = { launchDesktop, freePort };
