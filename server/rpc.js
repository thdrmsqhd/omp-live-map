// omp rpc-ui 자식 프로세스 하나를 감싼다: 줄 단위 JSON 파싱, ready 대기, 응답 id 대조. 모듈 상태는 없다.
"use strict";

const path = require("path");
const { spawn } = require("child_process");

// 맵이 띄우는 메인 세션에만 붙는 지시(서브에이전트에는 omp 가 넘기지 않는다).
// 이 플래그는 ~/.omp/agent/APPEND_SYSTEM.md 를 대신하므로, 그 파일을 만들면 이 파일에 합쳐야 한다.
const MAIN_PROMPT = path.join(__dirname, "main-card-prompt.md");

const READY_MS = 60000; // omp 가 ready 를 낼 때까지 기다리는 시간
const REPLY_MS = 30000; // 명령 하나의 응답을 기다리는 시간
const KILL_MS = 5000; // stdin 을 닫은 뒤 강제 종료까지 기다리는 시간

// omp 가 띄운 워커·MCP·셸까지 함께 끝낸다. Windows 의 child.kill() 은 omp.exe 하나만 죽인다.
function killTree(child) {
  const direct = () => { try { child.kill(); } catch {} };
  if (process.platform !== "win32" || !child.pid) return direct();
  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", direct);
}

// omp 를 띄운다. resume(세션 파일 경로)을 주면 그 세션을 이어 붙인다.
// 반환: { child, send(cmd) → 응답 프레임 Promise, onEvent(fn) 모든 프레임 구독, close() }
function open({ cwd, resume }) {
  const args = ["--mode", "rpc-ui", "--append-system-prompt", MAIN_PROMPT];
  if (resume) args.push("-r", resume);
  const child = spawn("omp", args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); // 명령 id -> { resolve, reject, timer }
  const listeners = [];
  let seq = 0, buf = "", dead = null, readyOk, readyFail;
  const ready = new Promise((resolve, reject) => { readyOk = resolve; readyFail = reject; });
  ready.catch(() => {});
  const readyTimer = setTimeout(() => readyFail(new Error("omp 시작 시간 초과")), READY_MS);

  // 프로세스가 끝나면 기다리던 명령을 모두 실패로 돌린다.
  const die = (why) => {
    if (dead) return;
    dead = new Error(why);
    clearTimeout(readyTimer);
    readyFail(dead);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(dead); }
    pending.clear();
  };

  const onLine = (line) => {
    if (!line.startsWith("{")) return;
    let e;
    try { e = JSON.parse(line); } catch { return; }
    if (e.type === "ready") {
      clearTimeout(readyTimer);
      readyOk();
    } else if (e.type === "response" && pending.has(e.id)) {
      const p = pending.get(e.id);
      pending.delete(e.id);
      clearTimeout(p.timer);
      p.resolve(e);
    }
    for (const fn of listeners) { try { fn(e); } catch {} }
  };

  // setEncoding 이 청크 경계에서 잘린 한글(멀티바이트)을 이어 붙인다.
  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        onLine(line);
      }
    });
  }
  if (child.stderr) child.stderr.on("data", () => {});
  if (child.stdin) child.stdin.on("error", () => {});
  child.on("error", (err) => die("omp 실행 실패: " + err.message));
  child.on("close", (code) => die("omp 종료 (code " + code + ")"));

  // 명령에 id 를 붙여 보내고, 같은 id 의 response 프레임으로 resolve 한다.
  // opts.timeoutMs 는 기다리는 시간만 바꾼다(압축은 요약 모델 호출까지 끝나야 응답이 온다).
  const send = async (cmd, opts = {}) => {
    await ready;
    if (dead) throw dead;
    const id = "m" + (++seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("omp 응답 시간 초과: " + cmd.type));
      }, opts.timeoutMs || REPLY_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
    });
  };

  const onEvent = (fn) => { listeners.push(fn); };

  // id 상관 없이 프레임을 그대로 보낸다(extension_ui_response 는 응답 프레임이 오지 않는다).
  const sendRaw = (frame) => {
    if (dead || !child.stdin) return false;
    try { child.stdin.write(JSON.stringify(frame) + "\n"); return true; } catch { return false; }
  };

  // stdin 을 닫으면 omp 가 스스로 정리하고 끝난다. 5초 뒤에도 살아 있으면 트리째 죽인다.
  const close = () => {
    if (dead) return;
    try { child.stdin.end(); } catch {}
    const timer = setTimeout(() => killTree(child), KILL_MS);
    child.once("close", () => clearTimeout(timer));
  };

  return { child, send, sendRaw, onEvent, close };
}

module.exports = { open, killTree };
