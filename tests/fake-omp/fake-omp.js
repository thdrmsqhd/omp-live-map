// 가짜 omp: 맵이 기대하는 rpc-ui 프로토콜(ready·response·extension_ui_request·턴 이벤트)을 흉내 낸다.
// 진짜 omp 대신 PATH 앞의 bin/omp.exe 가 이 파일을 node 로 띄운다(launch.js).
"use strict";

const fs = require("fs");
const path = require("path");
const { makeSession, iso } = require("./session-file");

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "";
};

// 맵이 isHeld() 로 부르는 `omp session lease --json -- <id>`: 쥔 세션 없음으로 답하고 끝난다.
if (argv[0] === "session") {
  process.stdout.write(JSON.stringify({ held: [] }) + "\n");
  process.exit(0);
}

const LOG = process.env.FAKE_OMP_LOG || path.join(__dirname, "fake-omp.log.jsonl");
fs.mkdirSync(path.dirname(LOG), { recursive: true });

const log = (dir, value) => {
  try {
    fs.appendFileSync(LOG, JSON.stringify({ ts: Date.now(), dir, ...value }) + "\n");
  } catch {}
};
const out = (frame) => {
  log("out", { frame });
  process.stdout.write(JSON.stringify(frame) + "\n");
};
const ok = (id, command, data) => out({ type: "response", id, command, success: true, ...(data ? { data } : {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 세션 기록(jsonl): 맵의 tail 이 읽는 형식. ---
const resume = argOf("-r");
let session = null;
const ensure = () => session || (session = makeSession(resume, process.cwd()));

// --- 시나리오: FAKE_OMP_SCENARIO 가 가리키는 JSON 의 steps 를 순서대로 보낸다. ---
const WAIT_METHODS = new Set(["ask", "select", "confirm", "input", "editor"]);
let steps = [];
const scenarioPath = process.env.FAKE_OMP_SCENARIO || "";
if (scenarioPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
    steps = Array.isArray(raw) ? raw : Array.isArray(raw.steps) ? raw.steps : [];
  } catch (e) {
    log("err", { scenario: scenarioPath, message: String(e) });
  }
}

let seq = 0;
let askEnabled = false;
let aborted = false;
const askWaiters = [];
const waiting = new Map(); // 요청 id -> resolve(응답 프레임)

function waitAskEnabled() {
  if (askEnabled) return Promise.resolve();
  return new Promise((r) => askWaiters.push(r));
}

// 확장 UI 요청 하나를 보내고, 답이 오는 method 면 extension_ui_response 를 기다린다.
function request(step) {
  const id = step.id || "q" + ++seq;
  const frame = { type: "extension_ui_request", ...step, id };
  delete frame.waitMs;
  out(frame);
  const waitMs = Number(step.waitMs) || (Number(step.timeout) > 0 ? Number(step.timeout) + 2000 : 120000);
  if (step.wait === false || !WAIT_METHODS.has(step.method)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      log("timeout", { id });
      resolve(null);
    }, waitMs);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

async function runScenario() {
  for (const step of steps) {
    if (aborted) return;
    if (step.method === "ask") await waitAskEnabled();
    await request(step);
  }
}

// --- stdin 처리 ---
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function handle(line) {
  log("in", { line });
  let c;
  try {
    c = JSON.parse(line);
  } catch {
    log("err", { bad: line });
    return;
  }
  if (c.type === "extension_ui_response") {
    const w = waiting.get(c.id);
    if (w) {
      waiting.delete(c.id);
      w(c);
    }
    return;
  }
  if (c.type === "get_state") {
    const se = ensure();
    ok(c.id, c.type, {
      sessionFile: se.file,
      sessionId: se.id,
      cwd: process.cwd(),
      model: { provider: "fake", id: "fake-1", name: "Fake OMP" },
    });
    return;
  }
  if (c.type === "set_subagent_subscription") {
    ok(c.id, c.type, { level: c.level || "events" });
    return;
  }
  if (c.type === "set_ask_dialog") {
    askEnabled = !!c.enabled && c.enabled !== "false";
    ok(c.id, c.type, { enabled: askEnabled });
    if (askEnabled) for (const r of askWaiters.splice(0)) r();
    return;
  }
  if (c.type === "abort") {
    aborted = true;
    ok(c.id, c.type);
    for (const [id, w] of waiting) {
      waiting.delete(id);
      w({ type: "extension_ui_response", id, cancelled: true });
    }
    out({ type: "agent_end" });
    return;
  }
  if (c.type === "prompt") {
    ok(c.id, c.type);
    runTurn(String(c.message || ""));
    return;
  }
  ok(c.id, c.type);
}

async function runTurn(text) {
  ensure().append({ type: "message", id: "u" + Date.now(), timestamp: iso(Date.now()), message: { role: "user", content: text } });
  out({ type: "agent_start" });
  out({ type: "turn_start" });
  out({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
  const reply = process.env.FAKE_OMP_REPLY || "가짜 omp 응답입니다. ";
  for (const chunk of reply.match(/.{1,6}/g) || []) {
    out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: chunk } });
    await sleep(15);
  }
  await runScenario();
  out({ type: "message_update", assistantMessageEvent: { type: "text_end" } });
  const message = {
    role: "assistant",
    provider: "fake",
    model: "fake-1",
    content: [{ type: "text", text: reply }],
    stopReason: "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2, cost: { total: 0 } },
    timestamp: Date.now(),
  };
  out({ type: "turn_end", message });
  ensure().append({ type: "message", id: "a" + Date.now(), timestamp: iso(Date.now()), message });
  if (!aborted) out({ type: "agent_end" });
}

out({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 });
