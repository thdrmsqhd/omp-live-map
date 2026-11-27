"use strict";

// 실행기 목록이 한 표(adapter-registry.js)에서만 정해지는지 확인한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { adapterIds, adapterSpec, isAdapter } = require("../server/engineering/adapter-registry");
const { adaptersFor, runners } = require("../server/engineering/adapters");

const SERVER = path.resolve(__dirname, "../server");

test("every registered adapter has a runner and adaptersFor builds all of them", () => {
  assert.deepEqual(Object.keys(runners).sort(), [...adapterIds].sort());
  const built = adaptersFor({ enforced: true, supports: () => true }, { rpc: {}, asks: {} });
  assert.deepEqual([...built.keys()].sort(), [...adapterIds].sort());
});

test("registry answers membership, reasoning support and provider", () => {
  assert.equal(isAdapter("omp"), true);
  assert.equal(isAdapter("toString"), false, "prototype keys are not adapters");
  assert.equal(isAdapter("codex"), false);
  assert.equal(adapterSpec("claude").reasoning, false);
  assert.equal(adapterSpec("claude").provider({ provider: "openai" }), "anthropic");
  assert.equal(adapterSpec("omp").provider({ provider: "openai" }), "openai");
});

test("no server module re-lists the adapter set as a literal array", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && /\[\s*["']omp["']\s*,\s*["']claude["']\s*\]/.test(fs.readFileSync(full, "utf8"))) {
        offenders.push(path.relative(SERVER, full));
      }
    }
  };
  walk(SERVER);
  assert.deepEqual(offenders, []);
});
