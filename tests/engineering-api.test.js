"use strict";

const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");
const { runtime } = require("../server/engineering/runtime");

test("engineering API requires its desktop token and preserves the original graph", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-api-"));
  const token = randomBytes(32).toString("hex");
  process.env.OMP_MAP_ENGINEERING_TOKEN = token;
  process.env.OMP_MAP_ENGINEERING_DATA = directory;
  try {
    await withLegacyHttp(t, async ({ request }) => {
      assert.equal((await request("/api/graph")).status, 200);
      assert.equal((await request("/api/engineering/projects")).status, 403);
      assert.equal((await request("/api/engineering/runtime/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      })).status, 403);
      for (const endpoint of ["harness/preview", "harness/apply", "harness/trial", "harness/trial/cancel", "harness/trial/retry"]) {
        const response = await request("/api/engineering/" + endpoint, {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}",
        });
        assert.equal(response.status, 403, endpoint);
      }
      const headers = { "x-omp-engineering-token": token };
      assert.equal((await request("/api/engineering/workflow-live-map")).status, 403);
      const liveMap = await request("/api/engineering/workflow-live-map", { headers });
      assert.equal(liveMap.status, 200);
      assert.deepEqual(JSON.parse(liveMap.text), { total: 0, attention: [], recent: [] });
      const response = await request("/api/engineering/capabilities", { headers });
      assert.deepEqual(JSON.parse(response.text), { omp: false, claude: false });
      assert.equal(process.env.OMP_MAP_ENGINEERING_TOKEN, undefined);
      assert.equal((await request("/api/engineering/projects", {
        headers: { ...headers, origin: "https://example.invalid" },
      })).status, 403);
      const bad = await request("/api/engineering/definitions", {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "[]",
      });
      assert.equal(bad.status, 400);
    });
  } finally {
    delete process.env.OMP_MAP_ENGINEERING_DATA;
    // The server owns the connection for the life of this isolated test process.
    if (process.platform !== "win32") await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Console login can be started, cancelled, and completed independently of Docker", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-console-login-"));
  let finish;
  let starts = 0;
  let verifications = 0;
  const runner = runtime(directory, null, {
    login(signal) {
      starts += 1;
      return new Promise((resolve, reject) => {
        finish = resolve;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    async accessToken() { verifications += 1; return "fixture"; },
  });
  const settle = () => new Promise(setImmediate);
  try {
    runner.login();
    runner.login();
    assert.equal(starts, 1);
    assert.equal(runner.status().signingIn, true);
    runner.login(true);
    await settle();
    assert.equal(runner.status().signingIn, false);
    assert.match(runner.status().loginStatus, /취소/);
    assert.equal(verifications, 0);
    runner.login();
    finish();
    await settle();
    assert.equal(runner.status().signingIn, false);
    assert.match(runner.status().loginStatus, /연결/);
    assert.ok(verifications >= 1);
    assert.doesNotMatch(JSON.stringify(runner.status()), /fixture/);
  } finally {
    runner.shutdown();
    await runner.prepare();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
