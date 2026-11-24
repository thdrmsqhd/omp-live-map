"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { createWindowsChecks } = require("../../server/engineering/windows-checks");

test("Windows verification runner denies private files, local network, and child commands", { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-checks-"));
  const listener = net.createServer((socket) => socket.end());
  listener.listen(0, "127.0.0.1");
  try {
    await once(listener, "listening");
    const canonical = await fs.realpath(directory);
    const root = path.join(canonical, "worktrees");
    const cwd = path.join(root, "test");
    const runtime = path.join(canonical, "runtime");
    const privateFile = path.join(canonical, "private.txt");
    const node = path.join(runtime, "node.exe");
    const check = { command: "node", args: ["--preserve-symlinks-main", "--preserve-symlinks", "verify.cjs"], code: 0 };
    const denied = { command: "node", args: ["other.cjs"], code: 0 };
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(runtime);
    await fs.copyFile(process.execPath, node);
    await fs.writeFile(privateFile, "outside fixture");
    await fs.writeFile(path.join(cwd, "verify.cjs"), `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const net = require("node:net");
      assert.equal(process.env.OMP_TEST_PRIVATE_SECRET, undefined);
      fs.writeFileSync("verified.txt", "inside");
      assert.throws(() => fs.readFileSync(${JSON.stringify(privateFile)}));
      assert.throws(() => fs.writeFileSync(${JSON.stringify(privateFile)}, "changed"));
      fs.writeFileSync("files-denied.txt", "");
      const socket = net.connect(${listener.address().port}, "127.0.0.1");
      const settle = () => { socket.destroy(); console.log("isolated"); };
      const deadline = setTimeout(settle, 1800);
      socket.once("connect", () => { clearTimeout(deadline); socket.destroy(); process.exitCode = 19; });
      socket.once("error", () => { clearTimeout(deadline); settle(); });
    `);
    const runner = createWindowsChecks({
      launcher: path.resolve(process.argv[2]), worktreeRoot: root,
      programs: new Map([["node", node]]), allowlist: [check],
    });
    const signal = AbortSignal.timeout(25000);
    const control = net.connect(listener.address().port, "127.0.0.1");
    try { await once(control, "connect"); } finally { control.destroy(); }
    await assert.rejects(runner.execute(denied, cwd, signal), /not allowed/);
    await assert.rejects(runner.execute(check, runtime, signal), /worktree path/);
    const alias = path.join(cwd, "private-alias.txt");
    await fs.link(privateFile, alias);
    try { await assert.rejects(runner.execute(check, cwd, signal), /Hard links are not supported/); }
    finally { await fs.unlink(alias); }
    process.env.OMP_TEST_PRIVATE_SECRET = "parent-only";
    const result = await runner.execute(check, cwd, signal).catch(async (error) => {
      const markers = await fs.readdir(cwd);
      throw new Error("Windows check did not finish. Workspace evidence: " + markers.join(", "), { cause: error });
    });
    delete process.env.OMP_TEST_PRIVATE_SECRET;
    assert.equal(result.code, 0, result.log);
    assert.match(result.log, /isolated/);
    assert.equal(await fs.readFile(path.join(cwd, "verified.txt"), "utf8"), "inside");
    assert.equal(await fs.readFile(privateFile, "utf8"), "outside fixture");
    await assert.rejects(fs.stat(path.join(cwd, "child-launched.txt")), { code: "ENOENT" });

    await fs.writeFile(path.join(cwd, "verify.cjs"), `
      const fs = require("node:fs");
      fs.writeFileSync("pid.txt", String(process.pid));
      try {
        require("node:child_process").execFileSync(process.execPath, [
          "-e", "require('fs').writeFileSync('child-launched.txt', 'bad')",
        ]);
      } catch {}
      setTimeout(() => {}, 12000);
    `);
    const controller = new AbortController();
    const running = runner.execute(check, cwd, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    running.catch(() => {});
    const pidFile = path.join(cwd, "pid.txt");
    let pid;
    for (let i = 0; i < 100 && !pid; i++) {
      pid = Number(await fs.readFile(pidFile, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      }));
      if (!pid) await delay(75);
    }
    assert.ok(Number.isInteger(pid) && pid > 0, "Isolated process did not start");
    await delay(1000);
    await assert.rejects(fs.stat(path.join(cwd, "child-launched.txt")), { code: "ENOENT" });
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    const stopped = () => {
      try { process.kill(pid, 0); return false; }
      catch (error) { if (error.code !== "ESRCH") throw error; return true; }
    };
    for (let i = 0; i < 40 && !stopped(); i++) await delay(50);
    assert.equal(stopped(), true);

  } finally {
    delete process.env.OMP_TEST_PRIVATE_SECRET;
    listener.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 4 });
  }
});
