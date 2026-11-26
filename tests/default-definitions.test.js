"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { models: allowed } = require("../server/engineering/anthropic");
const { openDatabase } = require("../server/engineering/database");
const { catalog } = require("../server/engineering/catalog");
const { addPresetDefinitions } = require("../server/engineering/workflow-presets");
const { MODELS, HARNESSES } = require("../server/engineering/default-definitions");

test("기본 하네스는 최신 Claude 모델을 쓰고 설계와 리뷰는 서로 다른 모델이다", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-defaults-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    const catalogues = catalog(db);
    const first = addPresetDefinitions(db, catalogues, null);
    const entries = () => catalogues.definitions(null, "personal");
    const byName = (kind) => new Map(entries().filter((entry) => entry.kind === kind).map((entry) => [entry.name, entry]));

    const models = byName("model");
    assert.deepEqual([...models.keys()].sort(), Object.values(MODELS).map(({ name }) => name).sort());
    for (const { name, model } of Object.values(MODELS)) {
      assert.ok(allowed.has(model), `${model} must be allowed by the Anthropic broker`);
      assert.equal(models.get(name).payload.model, model);
    }

    const harnesses = byName("harness");
    assert.equal(harnesses.size, Object.keys(HARNESSES).length);
    const modelOf = (key) => models.get(MODELS[HARNESSES[key].model].name).id;
    for (const [key, spec] of Object.entries(HARNESSES)) {
      const saved = harnesses.get(spec.name).payload;
      assert.equal(saved.adapter, "claude");
      assert.equal(saved.model, modelOf(key));
      assert.ok(saved.instructions.length > 40, `${spec.name} needs working instructions`);
    }
    assert.notEqual(harnesses.get(HARNESSES.author.name).payload.model, harnesses.get(HARNESSES.reviewer.name).payload.model);
    assert.equal(first.author, harnesses.get(HARNESSES.author.name).id);
    assert.equal(first.reviewer, harnesses.get(HARNESSES.reviewer.name).id);
    const loop = byName("loop").get("기본 · 개발 및 테스트");
    assert.equal(loop.payload.harness, harnesses.get(HARNESSES.developer.name).id);

    const before = entries().length;
    assert.deepEqual(addPresetDefinitions(db, catalogues, null), first);
    assert.equal(entries().length, before, "running the defaults twice must not duplicate definitions");
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("최신 모델이 모델 선택 목록의 앞에 온다", () => {
  const order = [...allowed];
  assert.deepEqual(order.slice(0, 4), ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.ok(order.includes("claude-sonnet-4-6"), "saved definitions on the previous model must keep running");
});
