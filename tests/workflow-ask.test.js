"use strict";

// Engineering 실행은 이 PC 에 설치된 omp 를 그대로 띄우므로, 도구 목록은 사용자의 omp 설정을 따른다(ask 포함).
// 실행기는 워크플로가 질문을 켠 경우에만 extension_ui_request 를 질문 카드로 받고, 그 밖에는 거절한다.
// 이 동작은 도구 목록과 무관하게 RPC 프레임만으로 정해진다.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { adaptersFor } = require("../server/engineering/adapters");
const { answer, asksFor, allAsks, drop } = require("../server/ui-requests");

const fakeScript = `
"use strict";
const fs = require("node:fs");
const mode = process.env.WORKFLOW_ASK_FAKE || "ask";
const log = process.env.WORKFLOW_ASK_LOG || "";
let buf = "";
let stage = 0;
const out = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
function finish() {
  out({ type: "turn_end", message: { role: "assistant", stopReason: "stop",
    content: [{ type: "text", text: "continued" }], usage: { cost: { total: 0 } } } });
  out({ type: "agent_end" });
}
function handle(line) {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command.type === "extension_ui_response") {
    if (log) fs.appendFileSync(log, JSON.stringify(command) + "\\n");
    if (mode === "ask" && stage === 0) {
      stage = 1;
      out({ type: "extension_ui_request", id: "q2", method: "select", title: "Pick",
        options: ["SQLite", "Postgres"], timeout: 0 });
      return;
    }
    finish();
    return;
  }
  if (command.type === "get_state") {
    out({ type: "response", id: command.id, command: command.type, success: true, data: { sessionId: "sess-ask" } });
    return;
  }
  if (command.type === "prompt") {
    out({ type: "response", id: command.id, command: command.type, success: true, data: {} });
    if (mode === "input") {
      out({ type: "extension_ui_request", id: "q-in", method: "input", title: "Name", placeholder: "x" });
      return;
    }
    if (mode === "secret") {
      out({ type: "extension_ui_request", id: "q-sec", method: "ask", questions: [
        { id: "pw", question: "What is your password?", options: [{ label: "skip" }] }] });
      return;
    }
    out({ type: "extension_ui_request", id: "q1", method: "ask", timeout: 0, questions: [
      { id: "db", question: "Which database?", recommended: 0,
        options: [{ label: "SQLite" }, { label: "Postgres" }] }] });
    return;
  }
  if (command.id) out({ type: "response", id: command.id, command: command.type, success: true, data: {} });
}
out({ type: "ready", protocolVersion: 1 });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let index;
  while ((index = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, index).trim();
    buf = buf.slice(index + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

function waitFor(read, timeout = 4000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value;
      try { value = read(); } catch (error) { reject(error); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - start > timeout) { reject(new Error("timed out waiting for workflow ask")); return; }
      setTimeout(tick, 15);
    };
    tick();
  });
}

test("workflow ask registers a question and keeps input and non-workflow runs rejected", { timeout: 15000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-workflow-ask-"));
  const script = path.join(directory, "fake-rpc.js");
  const logPath = path.join(directory, "responses.jsonl");
  await fs.writeFile(script, fakeScript);
  t.after(async () => {
    for (const item of allAsks()) if (String(item.node).startsWith("workflow-ask:")) drop(item.node);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const model = { provider: "fake", model: "fake-1" };
  const harness = { role: "developer" };
  function agent(mode) {
    const backend = {
      enforced: true,
      supports: () => true,
      launch(_program, _args, options) {
        return spawn(process.execPath, [script], {
          cwd: options.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, WORKFLOW_ASK_FAKE: mode, WORKFLOW_ASK_LOG: logPath },
        });
      },
      terminate(child) { child.kill(); },
    };
    return adaptersFor(backend).get("omp");
  }
  function run(mode, extra = {}) {
    return agent(mode).run({
      model, cwd: directory, instruction: "fixture", feedback: [], budgetCents: 4, harness,
      signal: AbortSignal.timeout(8000), capture: true, ...extra,
    });
  }

  const progress = [];
  const running = run("ask", { workflowAsk: true, onProgress: (patch) => progress.push(patch) });
  const settled = running.then((result) => ({ ok: true, result }), (error) => ({ ok: false, error }));
  const key = await waitFor(() => progress.find((patch) => patch.askSession)?.askSession);
  assert.match(key, /^workflow-ask:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(progress.filter((patch) => patch.askSession), [{ askSession: key }]);
  assert.deepEqual(asksFor(key), [{
    id: "q1", method: "ask", timeout: 0,
    questions: [{
      id: "db", question: "Which database?", header: "", multi: false, recommended: 0,
      options: [{ label: "SQLite", description: "", preview: "" }, { label: "Postgres", description: "", preview: "" }],
    }],
  }]);
  assert.equal(answer(key, "q1", { answers: [{ id: "db", selectedOptions: ["SQLite"] }] }).ok, true);
  await waitFor(() => asksFor(key).some((request) => request.id === "q2"));
  assert.deepEqual(progress.filter((patch) => patch.askSession), [{ askSession: key }]);
  assert.equal(asksFor(key).find((request) => request.id === "q2").method, "select");
  assert.equal(answer(key, "q2", { value: "SQLite" }).ok, true);
  const done = await settled;
  assert.equal(done.ok, true, done.error && done.error.stack);
  assert.equal(done.result.sessionId, "sess-ask");
  assert.equal(done.result.output, "continued");
  const frames = (await fs.readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(frames, [
    { type: "extension_ui_response", id: "q1", answers: [{ id: "db", selectedOptions: ["SQLite"] }] },
    { type: "extension_ui_response", id: "q2", value: "SQLite" },
  ]);
  assert.equal(asksFor(key).length, 0);

  const inputProgress = [];
  await assert.rejects(
    run("input", { workflowAsk: true, onProgress: (patch) => inputProgress.push(patch) }),
    /Interactive OMP request is unsupported in a Loop: input/,
  );
  assert.equal(inputProgress.some((patch) => patch.askSession), false);

  const blockedProgress = [];
  await assert.rejects(
    run("ask"),
    /Interactive OMP request is unsupported in a Loop: ask/,
  );
  await assert.rejects(
    run("secret", { workflowAsk: true, onProgress: (patch) => blockedProgress.push(patch) }),
    (error) => {
      assert.match(error.message, /Interactive OMP request is unsupported in a Loop: ask/);
      assert.equal(error.message.includes("password"), false);
      return true;
    },
  );
  assert.equal(blockedProgress.some((patch) => patch.askSession), false);
  assert.equal(allAsks().some((item) => JSON.stringify(item).toLowerCase().includes("password")), false);
});
