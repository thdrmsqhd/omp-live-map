"use strict";

const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
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
      const models = await request("/api/session/model-options");
      assert.equal(models.status, 200);
      assert.ok(JSON.parse(models.text).engineering.some(({ provider, id }) => provider === "anthropic" && id === "claude-sonnet-4-6"));
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

      const root = await fs.mkdtemp(path.join(directory, "project-"));
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
      execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture", "--allow-empty"], { cwd: root });
      async function send(endpoint, payload, expected = 200) {
        const response = await request("/api/engineering/" + endpoint, payload === undefined ? { headers } : {
          method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(payload),
        });
        assert.equal(response.status, expected, response.text);
        return JSON.parse(response.text);
      }
      const reusable = await send("workflows/presets/defaults", { scope: "personal" });
      assert.deepEqual(await send("workflows/presets/defaults", { scope: "personal" }), reusable);
      const personal = await send("definitions?scope=personal");
      assert.equal(personal.length, 13); // 모델 4 + 하네스 5 + 루프 4
      assert.equal(personal.find(({ id }) => id === reusable.loop).project, null);
      const team = await send("teams", { name: "Platform" });
      assert.equal(team, "Platform");
      assert.deepEqual(await send("teams"), ["Platform"]);
      assert.equal((await send("definitions", { scope: "team", team, kind: "loop",
        payload: { ...personal.find(({ id }) => id === reusable.loop).payload, name: "Team loop" },
      })).team, team);
      const { id: project } = await send("projects", { name: "Fixture", root });
      const initial = await send("definitions?project=" + project);
      assert.ok(initial.some(({ id }) => id === reusable.loop));
      assert.ok(initial.every(({ scope }) => scope === "personal"));
      const shared = await send("workflows/presets", { project, preset: "refactor", name: "Shared setup", refs: reusable });
      assert.equal(shared.payload.nodes.find(({ type }) => type === "loop").definition, reusable.loop);
      const refs = await send("workflows/presets/defaults", { project });
      assert.notEqual(refs.author, refs.reviewer);
      assert.deepEqual(await send("workflows/presets/defaults", { project }), refs);
      assert.equal((await send("definitions?project=" + project)).length, 26); // 개인 기본 13 + 프로젝트 기본 13
      const saved = await send("workflows/presets", { project, preset: "refactor", name: "부분수정", refs });
      assert.deepEqual(saved.payload.nodes.filter(({ definition }) => definition).map(({ definition }) => definition),
        [refs.author, refs.loop, refs.reviewer]);
      const sharedNode = shared.payload.nodes.find(({ type }) => type === "loop");
      const edited = await send("workflows/save-canvas", { project, id: shared.id, version: shared.version,
        payload: shared.payload, loops: [{ node: sharedNode.id, attempts: 2 }] });
      const editedLoop = edited.payload.nodes.find(({ type }) => type === "loop").definition;
      assert.notEqual(editedLoop, reusable.loop);
      const available = await send("definitions?project=" + project);
      assert.equal(available.find(({ id }) => id === reusable.loop).payload.attempts, 3);
      assert.equal(available.find(({ id }) => id === editedLoop).payload.attempts, 2);
      await send("projects/archive", { id: project });
      await send("workflows/presets/defaults", { project }, 409);
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
