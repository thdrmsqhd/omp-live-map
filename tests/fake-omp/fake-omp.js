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
let model = { provider: "fake", id: "fake-1", name: "Fake OMP" };
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

// omp G(): 체크박스 select 는 항목 하나를 토글한 뒤 같은 질문을 다시 내고, Done 하나로 끝난다.
async function checkboxLoop(step) {
  const labels = (step.options || []).map(String);
  const other = step.other === false ? null : step.otherLabel || "Other (type your own)";
  const visible = other ? [...labels, other] : [...labels];
  const done = step.doneLabel || "✓ Done selecting";
  const shown = [...visible, done];
  const checked = new Set(step.checked || []);
  const picked = [];
  for (let n = 0; n < 30; n++) {
    const r = await request({
      method: "select", id: `${step.id || "cb"}-${n}`, title: step.title,
      options: shown, selectionMarker: "checkbox",
      checkedIndices: [...checked].sort((a, b) => a - b), markableCount: visible.length,
      timeout: step.timeout || 120000,
    });
    if (!r) return log("cb", { stop: "timeout" });
    if (r.cancelled) return log("cb", { stop: "cancelled" });
    const v = String(r.value ?? "");
    if (v === done) return log("cb-done", { id: step.id, picked, checked: [...checked].map((i) => labels[i] ?? "(other)") });
    const i = visible.indexOf(v);
    if (i < 0) return log("cb", { stop: "unknown", value: v });
    if (other && i === visible.length - 1) return log("cb-other", { id: step.id, value: v });
    if (checked.has(i)) checked.delete(i); else checked.add(i);
    picked.push(v);
  }
  log("cb", { stop: "loop" });
}

async function runScenario() {
  for (const step of steps) {
    if (aborted) return;
    if (step.method === "checkboxLoop") { await waitAskEnabled(); await checkboxLoop(step); continue; }
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
      model,
    });
    return;
  }
  if (c.type === "set_model") {
    model = { provider: c.provider, id: c.modelId, name: c.modelId };
    ok(c.id, c.type, model);
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
  if (c.type === "new_session") {
    // 컨텍스트 없는 새 세션 파일로 갈아탄다(진짜 omp 와 같은 의미: 이전 파일은 그대로 남는다).
    const prev = process.env.FAKE_OMP_NEW_SESSION === "fail" ? null : makeSession(null, process.cwd());
    if (!prev) {
      out({ type: "response", id: c.id, command: c.type, success: false, error: "시나리오: 새 세션 거부" });
      return;
    }
    session = prev;
    ok(c.id, c.type, { sessionId: prev.id, cancelled: false });
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
