"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");
const { _electron: electron } = require("playwright");

test("Electron owns the existing local server and handles a port collision",
  { timeout: 45000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-electron-test-"));
    const witness = http.createServer((request, response) => response.end("existing server"));
    const target = path.join(__dirname, "electron-main.cjs");
    const launch = (port) => electron.launch({
      args: [target],
      env: { ...process.env, USERPROFILE: directory, OMP_MAP_STATE: directory, OMP_PROBE_PORT: String(port) },
      timeout: 15000,
    });
    try {
      witness.listen(0, "127.0.0.1");
      await once(witness, "listening");
      const port = witness.address().port;
      const base = `http://127.0.0.1:${port}`;

      const collision = await launch(port);
      try {
        const result = await collision.evaluate(() => globalThis.probe);
        assert.match(result.error, /EADDRINUSE/);
        assert.equal(collision.windows().length, 0);
      } finally {
        await collision.close();
      }
      await closeServer(witness);

      const app = await launch(port);
      let pid;
      try {
        const result = await app.evaluate(() => globalThis.probe);
        assert.equal(result.ready, true, result.error);
        pid = result.pid;
        assert.ok(Number.isInteger(pid));
        assert.equal(result.sandbox, true);
        assert.equal(result.contextIsolation, true);
        assert.equal(result.nodeIntegration, false);
        const window = await app.firstWindow();
        await window.locator("#stage").waitFor({ timeout: 5000 });
        const graph = await fetch(base + "/api/graph", { signal: AbortSignal.timeout(3000) });
        assert.equal(graph.status, 200);
        assert.ok(Array.isArray((await graph.json()).sessions));
      } finally {
        await app.close();
      }
      await assert.rejects(fetch(base + "/api/graph", { signal: AbortSignal.timeout(3000) }), /fetch failed/);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      console.log("Electron + existing local server lifecycle and collision passed");
    } finally {
      if (witness.listening) await closeServer(witness);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

async function closeServer(server) {
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}
