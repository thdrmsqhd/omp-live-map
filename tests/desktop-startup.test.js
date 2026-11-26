"use strict";

const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

test("the desktop listener can serve the UI while session history is still loading", { timeout: 30000 }, async () => {
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
    // 실제 사용자 HOME 의 세션 기록(~/.omp, ~/.claude)을 훑지 않도록 빈 HOME 으로 띄운다.
    // 기록이 많은 PC 에서 전체 테스트와 함께 돌면 이 스캔 때문에 준비 신호가 5초를 넘겨 시간 초과가 났다.
    env: { ...process.env, HOME: directory, USERPROFILE: directory, OMP_MAP_STATE: path.join(directory, "state") },
  });
  const closed = once(child, "close");
  try {
    const messages = {};
    await new Promise((resolve, reject) => {
      // 전체 테스트는 파일별 프로세스를 함께 돌리므로 CPU 가 바쁠 때도 버티게 넉넉히 기다린다.
      const timeout = AbortSignal.timeout(20000);
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
