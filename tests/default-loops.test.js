"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { permitted } = require("../server/infrastructure/host-process");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { buildPreset, addPresetDefinitions } = require("../server/engineering/workflow-presets");
const { HARNESSES, LOOPS, MODELS, PRESET_LOOPS } = require("../server/engineering/default-definitions");

test("기본 루프는 실행기가 허용하는 검증 명령만 쓰고 스키마 한도 안에 있다", () => {
  const allowed = new Set(permitted.map(({ command, args }) => [command, ...args].join(" ")));
  for (const loop of Object.values(LOOPS)) {
    assert.ok(HARNESSES[loop.harness], `${loop.name} must reference a default harness`);
    assert.ok(loop.checks.length >= 1 && loop.checks.length <= 10);
    for (const { command, args, code } of loop.checks) {
      assert.ok(allowed.has([command, ...args].join(" ")), `${loop.name}: ${command} ${args.join(" ")} is not permitted by the host allowlist`);
      assert.equal(code, 0);
    }
    assert.ok(loop.attempts >= 1 && loop.attempts <= 8);
    assert.ok(loop.timeoutMs >= 100 && loop.timeoutMs <= 3_600_000);
    assert.ok(loop.budgetCents >= 0 && loop.budgetCents <= 100_000);
  }
  assert.deepEqual(new Set(Object.values(LOOPS).flatMap(({ checks }) => checks.map(({ command }) => command))), new Set(["node", "npm", "python3"]));
});

test("루프마다 전용 하네스가 붙는다(같은 하네스를 두 루프가 나눠 쓰지 않는다)", () => {
  const used = Object.values(LOOPS).map(({ harness }) => harness);
  assert.equal(new Set(used).size, used.length, "each default loop needs its own harness");
  // 언어별 개발 하네스는 자기 루프의 검증 명령을 지시에 그대로 적어, 에이전트가 같은 명령으로 스스로 확인하게 한다.
  for (const key of ["feature", "featureNpm", "featurePython"]) {
    const { checks, harness, name } = LOOPS[key];
    const command = checks.map(({ command: c, args }) => [c, ...args].join(" ")).join(" ");
    assert.ok(HARNESSES[harness].instructions.includes("`" + command + "`"), `${name}: ${harness} instructions should name \`${command}\``);
  }
  assert.equal(HARNESSES[LOOPS.bugfix.harness].model, "opus");
  assert.ok(LOOPS.bugfix.attempts > LOOPS.feature.attempts && LOOPS.bugfix.budgetCents > LOOPS.feature.budgetCents);
});

test("기본 제공 Workflow 템플릿마다 맞는 루프를 처음 고른다", () => {
  assert.deepEqual(Object.keys(PRESET_LOOPS).sort(), ["bugfix", "feature", "refactor", "tests"]);
  for (const key of Object.values(PRESET_LOOPS)) assert.ok(LOOPS[key]);
  assert.equal(new Set(Object.values(PRESET_LOOPS)).size, 4, "each loop-based template gets a different default loop");
  for (const preset of Object.keys(PRESET_LOOPS)) {
    const graph = buildPreset(preset, { author: "a", reviewer: "r", loop: "l" });
    assert.ok(graph.nodes.some(({ type }) => type === "loop"), `${preset} contains a loop node`);
  }
});

test("기본 구성은 루프 6개를 만들고 각 루프가 자기 하네스를 가리킨다", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-loops-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    const catalogues = catalog(db);
    const refs = addPresetDefinitions(db, catalogues, null);
    const entries = catalogues.definitions(null, "personal");
    const loops = entries.filter(({ kind }) => kind === "loop");
    assert.deepEqual(loops.map(({ name }) => name).sort(), Object.values(LOOPS).map(({ name }) => name).sort());
    const harnessId = (key) => entries.find(({ kind, name }) => kind === "harness" && name === HARNESSES[key].name).id;
    for (const spec of Object.values(LOOPS)) {
      const saved = loops.find(({ name }) => name === spec.name);
      assert.equal(saved.payload.harness, harnessId(spec.harness));
      assert.equal(saved.payload.budgetCents, spec.budgetCents);
    }
    const idOf = (key) => loops.find(({ name }) => name === LOOPS[key].name).id;
    assert.equal(refs.loop, idOf("feature"));
    for (const [preset, key] of Object.entries(PRESET_LOOPS)) assert.equal(refs.loops[preset], idOf(key));
    assert.equal(new Set(Object.values(refs.loops)).size, 4);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});