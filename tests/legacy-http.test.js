"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

const post = (data) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

test("기존 HTTP 진입점, 세션 관측과 편집기 계약을 유지한다", async (t) => {
  await withLegacyHttp(t, async ({ directory, config, request }) => {
    await t.test("loopback API 요청 경계와 UI 진입점", async () => {
      const page = await request("/");
      assert.equal(page.status, 200);
      assert.match(page.text, /js\/app\.js/);
      assert.equal((await request("/api/graph", { headers: { host: "example.invalid" } })).status, 403);
      assert.equal((await request("/api/graph", { headers: { origin: "https://example.invalid" } })).status, 403);
      assert.equal((await request("/api/graph", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
      assert.equal((await request("/api/editor/read", { method: "POST" })).status, 415);
    });

    await t.test("부분 JSONL과 메인·서브 계보를 스냅샷과 SSE에 유지", async () => {
      const main = path.join(config.SESSIONS, "fixture", "main.jsonl");
      const sub = path.join(config.SESSIONS, "fixture", "main", "review.jsonl");
      await fs.mkdir(path.dirname(sub), { recursive: true });
      const timestamp = new Date().toISOString();
      const session = JSON.stringify({ type: "session", id: "main", cwd: directory, timestamp });
      const title = JSON.stringify({ type: "title", title: "fixture-title", timestamp });
      await fs.writeFile(main, `${session}\n${title.slice(0, 15)}`);
      await fs.writeFile(sub, `${session}\n`);
      const { scan } = require("../server/tail");
      scan();
      const before = JSON.parse((await request("/api/graph")).text);
      assert.equal(before.sessions.length, 1);
      assert.notEqual(before.sessions[0].title, "fixture-title");

      await fs.appendFile(main, title.slice(15) + "\n");
      scan();
      const graph = JSON.parse((await request("/api/graph")).text);
      const [cluster] = graph.sessions;
      assert.equal(cluster.title, "fixture-title");
      assert.equal(cluster.nodes.find(({ id }) => id === sub)?.parent, main);
      assert.equal(graph.harness.claude.context, false);

      const extension = path.join(directory, ".omp", "live-map");
      await fs.mkdir(extension, { recursive: true });
      await fs.writeFile(path.join(extension, "fixture.jsonl"),
        JSON.stringify({ node: main, kind: "text", text: "replayed" }) + "\n");
      require("../server/ext-live").tick();

      for (let connection = 0; connection < 2; connection++) {
        const stream = await request("/api/events", { frames: 2 });
        assert.equal(stream.status, 200);
        assert.match(stream.headers["content-type"], /^text\/event-stream/);
        const [snapshot, event] = stream.text.split("\n\n").map((line) => JSON.parse(line.slice(6)));
        assert.deepEqual(snapshot.sessions.map(({ key }) => key), graph.sessions.map(({ key }) => key));
        assert.deepEqual(event.live, { node: main, kind: "text", text: "replayed" });
      }
    });

    await t.test("Claude 기록을 메인·서브 카드와 실행 상태로 관측", async () => {
      execFileSync(process.execPath, [path.join(__dirname, "fake-claude", "seed.js")], {
        env: { ...process.env, FAKE_CLAUDE_HOME: directory, FAKE_CLAUDE_SEED_CWD: directory },
        timeout: 5000,
      });
      require("../server/harness/claude").scan();
      const graph = JSON.parse((await request("/api/graph")).text);
      const cluster = graph.sessions.find(({ harness }) => harness === "claude");
      assert.ok(cluster);
      const main = cluster.nodes.find(({ kind }) => kind === "main");
      assert.equal(main.harness, "claude");
      const subs = cluster.nodes.filter(({ kind }) => kind === "sub");
      assert.equal(subs.length, 2);
      assert.ok(subs.every(({ parent }) => parent === main.id));
      assert.deepEqual(new Set(subs.map(({ status }) => status)), new Set(["live", "done"]));
    });

    await t.test("편집기 읽기·저장 및 외부 변경 감지", async () => {
      const file = path.join(directory, "example.txt");
      await fs.writeFile(file, "original");
      const read = await request("/api/editor/read", post({ path: file }));
      const { ok, mtime, text } = JSON.parse(read.text);
      assert.equal(read.status, 200);
      assert.equal(ok, true);
      assert.equal(text, "original");
      const conflict = await request("/api/editor/write", post({ path: file, text: "stale", mtime: mtime - 5000 }));
      assert.equal(conflict.status, 409);
      assert.equal(await fs.readFile(file, "utf8"), "original");
      const save = await request("/api/editor/write", post({ path: file, text: "updated", mtime }));
      assert.equal(JSON.parse(save.text).ok, true);
      assert.equal(await fs.readFile(file, "utf8"), "updated");
    });
  });
});
