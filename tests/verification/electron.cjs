"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");
const { promisify } = require("node:util");
const executable = require("electron");

const run = promisify(execFile);

test("Electron owns the existing local server and handles a port collision",
  { timeout: 65000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-electron-test-"));
    const witness = http.createServer((request, response) => response.end("existing server"));
    const target = path.join(__dirname, "electron-main.cjs");
    async function launch(port, name) {
      const resultFile = path.join(directory, `${name}.json`);
      const env = {
        ...process.env,
        OMP_PROBE_DIRECTORY: directory,
        OMP_PROBE_PORT: String(port),
        OMP_PROBE_RESULT: resultFile,
      };
      await run(executable, [target], { env, timeout: 25000 });
      return JSON.parse(await fs.readFile(resultFile, "utf8"));
    }

    try {
      witness.listen(0, "127.0.0.1");
      await once(witness, "listening");
      const port = witness.address().port;
      const base = `http://127.0.0.1:${port}`;

      const collision = await launch(port, "collision");
      assert.match(collision.error, /EADDRINUSE/);
      const response = await fetch(base, { signal: AbortSignal.timeout(3000) });
      assert.equal(await response.text(), "existing server");
      await closeServer(witness);

      const result = await launch(port, "clean");
      assert.equal(result.ready, true, result.error);
      assert.ok(Number.isInteger(result.pid));
      assert.equal(result.stageVisible, true);
      assert.equal(result.graphReady, true);
      assert.equal(result.sandbox, true);
      assert.equal(result.contextIsolation, true);
      assert.equal(result.nodeIntegration, false);
      await assert.rejects(fetch(base + "/api/graph", { signal: AbortSignal.timeout(3000) }), /fetch failed/);
      assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
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
