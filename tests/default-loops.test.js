"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAnthropicBroker } = require("../server/engineering/anthropic");
const { permitted } = require("../server/engineering/docker-runner");
const { openDatabase } = require("../server/engineering/database");
const { catalog } = require("../server/engineering/catalog");
const { addPresetDefinitions } = require("../server/engineering/workflow-presets");
const { HARNESSES, LOOPS, MODELS } = require("../server/engineering/default-definitions");

// 컨텍스트 20K 토큰, 에이전트가 max_tokens 32000 을 요청하는(8192 로 잘리는) 모델 호출을 예산이 몇 번 받아 주는지 센다.
async function affordableCalls(budgetCents, model) {
  const broker = createAnthropicBroker({ model, key: "fixture", budgetCents, upstream: async (url) =>
    url.endsWith("count_tokens") ? Response.json({ input_tokens: 20000 }) : Response.json({ type: "message" }) });
  const body = JSON.stringify({ model, messages: [{ role: "user", content: "x" }], max_tokens: 32000 });
  let calls = 0;
  for (; calls < 500; calls++) {
    try { await broker.request({ path: "/v1/messages", method: "POST", body }); } catch { break; }
  }
  return calls;
}

test("기본 루프는 컨테이너가 허용하는 검증 명령만 쓰고 스키마 한도 안에 있다", () => {
  const allowed = new Set(permitted.map(({ command, args }) => [command, ...args].join(" ")));
  assert.equal(Object.keys(LOOPS).length, 4);
  for (const loop of Object.values(LOOPS)) {
    assert.ok(HARNESSES[loop.harness], `${loop.name} must reference a default harness`);
    assert.ok(loop.checks.length >= 1 && loop.checks.length <= 10);
    for (const { command, args, code } of loop.checks) {
      assert.ok(allowed.has([command, ...args].join(" ")), `${loop.name}: ${command} ${args.join(" ")} is not permitted in the container`);
      assert.equal(code, 0);
    }
    assert.ok(loop.attempts >= 1 && loop.attempts <= 8);
    assert.ok(loop.timeoutMs >= 100 && loop.timeoutMs <= 3_600_000);
    assert.ok(loop.budgetCents >= 0 && loop.budgetCents <= 100_000);
  }
  assert.deepEqual(new Set(Object.values(LOOPS).flatMap(({ checks }) => checks.map(({ command }) => command))), new Set(["node", "npm", "python3"]));
});

test("루프 예산은 실제 에이전트 호출을 충분히 받아 준다(보수적 예약 방식 기준)", async () => {
  const model = (name) => Object.values(MODELS).find((entry) => entry.name === name).model;
  const harnessModel = (key) => model(MODELS[HARNESSES[key].model].name);
  // 이전 기본값(100센트)은 호출을 한 번도 받지 못했다. 표준 루프는 시도당 20회 이상, 집중 루프는 50회 이상을 받아야 한다.
  assert.equal(await affordableCalls(100, harnessModel("developer")), 0);
  for (const [key, minimum] of [["node", 20], ["npm", 20], ["python", 20], ["deep", 50]]) {
    const loop = LOOPS[key];
    const calls = await affordableCalls(loop.budgetCents, harnessModel(loop.harness));
    assert.ok(calls >= minimum, `${loop.name}: ${calls} calls < ${minimum}`);
  }
});

test("표준 루프 3개는 같은 하네스·한도를 쓰고 집중 루프는 더 강한 모델과 더 큰 한도를 쓴다", () => {
  const { node, npm, python, deep } = LOOPS;
  for (const loop of [npm, python]) {
    assert.equal(loop.harness, node.harness);
    assert.deepEqual([loop.attempts, loop.timeoutMs, loop.budgetCents], [node.attempts, node.timeoutMs, node.budgetCents]);
  }
  assert.equal(HARNESSES[node.harness].model, "sonnet");
  assert.equal(HARNESSES[deep.harness].model, "opus");
  assert.ok(deep.attempts > node.attempts && deep.timeoutMs > node.timeoutMs && deep.budgetCents > node.budgetCents);
});

test("기본 구성은 루프 4개를 만들고 프리셋은 Node 표준 루프를 가리킨다", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-loops-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    const catalogues = catalog(db);
    const refs = addPresetDefinitions(db, catalogues, null);
    const entries = catalogues.definitions(null, "personal");
    const loops = entries.filter(({ kind }) => kind === "loop");
    assert.deepEqual(loops.map(({ name }) => name).sort(), Object.values(LOOPS).map(({ name }) => name).sort());
    const harnessId = (key) => entries.find(({ kind, name }) => kind === "harness" && name === HARNESSES[key].name).id;
    for (const [key, spec] of Object.entries(LOOPS)) {
      const saved = loops.find(({ name }) => name === spec.name);
      assert.equal(saved.payload.harness, harnessId(spec.harness));
      assert.equal(saved.payload.budgetCents, spec.budgetCents);
    }
    assert.equal(refs.loop, loops.find(({ name }) => name === LOOPS.node.name).id);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
