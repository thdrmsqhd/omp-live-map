"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
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
    const check = { command: "node", args: ["verify.cjs"], code: 0 };
    const denied = { command: "node", args: ["other.cjs"], code: 0 };
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(runtime);
    await fs.copyFile(process.execPath, node);
    await fs.writeFile(privateFile, "outside fixture");
    await fs.writeFile(path.join(cwd, "verify.cjs"), `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const cp = require("node:child_process");
      const net = require("node:net");
      assert.equal(process.env.OMP_TEST_PRIVATE_SECRET, undefined);
      fs.writeFileSync("verified.txt", "inside");
      assert.throws(() => fs.readFileSync(${JSON.stringify(privateFile)}));
      assert.throws(() => fs.writeFileSync(${JSON.stringify(privateFile)}, "changed"));
      assert.throws(() => cp.execFileSync(process.execPath, ["-e", "process.exit(0)"]));
      const socket = net.connect(${listener.address().port}, "127.0.0.1");
      socket.setTimeout(1500, () => { socket.destroy(); console.log("isolated"); });
      socket.once("connect", () => { socket.destroy(); process.exitCode = 19; });
      socket.once("error", () => console.log("isolated"));
    `);
    const runner = createWindowsChecks({
      launcher: path.resolve(process.argv[2]), worktreeRoot: root,
      programs: new Map([["node", node]]), allowlist: [check],
    });
    const signal = AbortSignal.timeout(25000);
    await assert.rejects(runner.execute(denied, cwd, signal), /not allowed/);
    await assert.rejects(runner.execute(check, runtime, signal), /worktree path/);
    process.env.OMP_TEST_PRIVATE_SECRET = "parent-only";
    const result = await runner.execute(check, cwd, signal);
    delete process.env.OMP_TEST_PRIVATE_SECRET;
    assert.equal(result.code, 0, result.log);
    assert.match(result.log, /isolated/);
    assert.equal(await fs.readFile(path.join(cwd, "verified.txt"), "utf8"), "inside");
    assert.equal(await fs.readFile(privateFile, "utf8"), "outside fixture");

    await fs.writeFile(path.join(cwd, "verify.cjs"), "setTimeout(() => require('node:fs').writeFileSync('late.txt','late'), 12000);");
    await assert.rejects(runner.execute(check, cwd, AbortSignal.timeout(8000)), { name: "TimeoutError" });
    await assert.rejects(fs.stat(path.join(cwd, "late.txt")), { code: "ENOENT" });
  } finally {
    delete process.env.OMP_TEST_PRIVATE_SECRET;
    listener.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 4 });
  }
});
