"use strict";

// 실행 중 예산 누적기(server/engineering/run-cost.js)와 실행기가 예산에 닿으면 그 자리에서 멈추는지.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { runCost, claudeUsd, BUDGET_REASON } = require("../server/engineering/run-cost");
const { runners } = require("../server/engineering/adapters");

const ompTurn = (usd) => ({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse",
  usage: { input: 10, output: 5, cost: { input: usd / 2, output: usd / 2, total: usd } }, content: [] } });

test("omp turn_end costs accumulate in cents and trip the budget when reached", () => {
  const meter = runCost({ budgetCents: 5 });
  assert.equal(meter.omp({ type: "message_update" }), false);
  assert.equal(meter.omp(ompTurn(0.02)), false);
  assert.equal(meter.omp(ompTurn(0.02)), false);
  assert.ok(Math.abs(meter.cents - 4) < 1e-9);
  assert.equal(meter.omp(ompTurn(0.01)), true, "reaching the budget exactly stops the run");
  assert.equal(meter.valid, true);
  const broken = runCost({ budgetCents: 5 });
  broken.omp({ type: "turn_end", message: { usage: {} } });
  assert.equal(broken.valid, false);
  const unlimited = runCost({ budgetCents: 0 });
  unlimited.omp(ompTurn(50));
  assert.equal(unlimited.over, false, "budget 0 means no limit");
});

test("claude stream-json: per-message usage priced once per message id, else the CLI total", () => {
  const prices = { "claude-x": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 };
  assert.ok(Math.abs(claudeUsd(usage, prices["claude-x"]) - 0.036) < 1e-9);
  const meter = runCost({ budgetCents: 10, model: "claude-x", prices });
  const assistant = (id, u) => ({ type: "assistant", message: { id, model: "claude-x", usage: u, content: [] } });
  meter.claude(assistant("msg_1", usage));
  meter.claude(assistant("msg_1", usage)); // 같은 메시지의 다음 블록: 다시 더하지 않는다
  assert.ok(Math.abs(meter.cents - 3.6) < 1e-9);
  assert.equal(meter.basis, "estimated");
  meter.claude(assistant("msg_2", usage));
  assert.equal(meter.over, false);
  assert.equal(meter.claude(assistant("msg_3", usage)), true, "10.8 cents ≥ 10 cents");
  const plain = runCost({ budgetCents: 10, model: "claude-y", prices });
  assert.equal(plain.claude(assistant("m", usage)), false, "no price for the model → wait for the CLI total");
  assert.equal(plain.cents, 0);
  plain.claude({ type: "result", subtype: "success", total_cost_usd: 0.12 });
  assert.equal(plain.over, true);
  assert.equal(plain.basis, "reported");
});

// omp RPC 를 흉내 내는 io: prompt 를 받으면 비용 있는 턴을 계속 낸다. abort 를 받으면 멈춘다.
function fakeOmpIo(turnUsd) {
  const sent = [];
  return { sent, asks: { asksFor: () => [], drop() {}, ask() {} }, rpc: { open() {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    let listener = () => {}, timer = null;
    const stop = () => { clearInterval(timer); setImmediate(() => child.emit("close", 0)); };
    return {
      child,
      onEvent(fn) { listener = fn; },
      sendRaw(frame) { sent.push(frame); if (frame.type === "abort") clearInterval(timer); return true; },
      async send(command) {
        sent.push(command);
        if (command.type === "get_state") return { success: true, data: { sessionId: "s-1" } };
        if (command.type === "prompt") timer = setInterval(() => listener(ompTurn(turnUsd)), 2);
        return { success: true, data: {} };
      },
      close: stop,
    };
  } } };
}

test("omp runner stops mid-run when the running total reaches the stage budget", { timeout: 5000 }, async () => {
  const io = fakeOmpIo(0.01);
  const backend = { terminate() {} };
  const context = { cwd: ".", model: { provider: "p", model: "m" }, signal: new AbortController().signal, budgetCents: 3,
    harness: { role: "r" }, instruction: "do", feedback: [] };
  await assert.rejects(runners.omp(backend, context, io), (error) => {
    assert.equal(error.message, BUDGET_REASON);
    assert.equal(error.budgetExceeded, true);
    assert.ok(error.costCents >= 3 && error.costCents < 4.5, "stops at the first turn that reaches the budget: " + error.costCents);
    assert.equal(error.sessionId, "s-1");
    return true;
  });
  assert.ok(io.sent.some((frame) => frame.type === "abort"), "the omp turn is aborted cleanly");
});

test("node executor fails the step with '예산 초과' and keeps the spent amount", async () => {
  const { nodeExecutor } = require("../server/engineering/workflow-node-executor");
  const { budgetError } = require("../server/engineering/run-cost");
  const harness = { kind: "harness", payload: { adapter: "omp", role: "r", instructions: "", assets: [], sources: [] } };
  const model = { kind: "model", payload: { provider: "p", model: "m" } };
  const catalog = {
    versionOf: () => harness, availableTo: () => true, dependency: (x) => (x === harness ? model : null), project: () => ({ id: "p" }),
  };
  const runner = { requireAdapter: () => ({ run: async () => { const e = budgetError(5.2); e.sessionId = "s-9"; throw e; } }) };
  const execute = nodeExecutor(catalog, runner);
  const node = { type: "agent", definition: "h", version: 1, instruction: "go", outputs: [] };
  const result = await execute(node, "p", ".", 5, new AbortController().signal);
  assert.equal(result.status, "failed");
  assert.equal(result.error, BUDGET_REASON);
  assert.equal(result.budgetExceeded, true);
  assert.equal(result.costCents, 5.2);
  assert.equal(result.attempts[0].sessionId, "s-9");
});
