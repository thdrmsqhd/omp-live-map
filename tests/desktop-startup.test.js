"use strict";

const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

test("the desktop listener can serve the UI while session history is still loading", { timeout: 10000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-startup-"));
  const release = path.join(directory, "release");
  const preload = path.join(directory, "slow-observation.cjs");
  const project = path.resolve(__dirname, "..");
  await fs.writeFile(preload, `
    const fs = require("node:fs");
    const tail = require(${JSON.stringify(path.join(project, "server/tail.js"))});
    const wait = new Int32Array(new SharedArrayBuffer(4));
    tail.scanSteps = function* () {
      process.send({type: "fixture-scanning"});
      while (!fs.existsSync(${JSON.stringify(release)})) {
        Atomics.wait(wait, 0, 0, 18);
        yield;
      }
    };
    require(${JSON.stringify(path.join(project, "server/harness/claude.js"))}).scanSteps = function* () {};
  `);
  const child = fork(path.join(project, "server.js"), ["--port", "0"], {
    execArgv: ["--require", preload], stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const closed = once(child, "close");
  try {
    const messages = {};
    await new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(5000);
      timeout.addEventListener("abort", () => reject(timeout.reason), { once: true });
      child.on("message", (message) => {
        messages[message.type] = message;
        if (messages["desktop-ready"] && messages["fixture-scanning"]) resolve();
      });
      void closed.then(([code]) => reject(new Error("Server exited: " + code)));
    });
    const origin = "http://127.0.0.1:" + messages["desktop-ready"].port;
    const response = await fetch(origin, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>OMP live map<\/title>/);
    await fs.writeFile(release, "");
    child.send({ type: "desktop-shutdown" });
    assert.equal((await closed)[0], 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
