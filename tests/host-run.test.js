"use strict";

// Engineering 실행은 Docker 없이 이 PC 에서, 고른 작업 폴더에 바로 프로세스를 띄운다.
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { hostProcesses, findExecutable, permitted } = require("../server/infrastructure/host-process");
const { hostRunner } = require("../server/engineering/runtime");
const { problem } = require("../server/engineering/state");

async function folder(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-host-run-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  return directory;
}

test("the host backend launches a real process in the chosen folder", async (t) => {
  const cwd = await folder(t);
  const processes = hostProcesses({ problem });
  assert.ok(findExecutable("node"), "node is found on PATH");
  const child = processes.launch("node", ["-e", "process.stdout.write(process.cwd())"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.setEncoding("utf8").on("data", (text) => { out += text; });
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  assert.equal(await fs.realpath(out), await fs.realpath(cwd));
  assert.throws(() => processes.launch("omp-live-map-missing-cli", [], { cwd }), /PATH/);
  assert.throws(() => processes.launch("node", ["--version"], { cwd: path.join(cwd, "missing") }), /작업 폴더/);
});

test("verification runs an allowlisted command on the host in the work folder", async (t) => {
  const cwd = await folder(t);
  await fs.writeFile(path.join(cwd, "sample.test.js"),
    "require('node:test')('ok', () => { require('node:fs').writeFileSync('ran.txt', 'yes'); });\n");
  // 바깥 node --test 가 자식에게 넘기는 표시를 지워, 안쪽 node --test 가 보통 터미널에서처럼 돈다.
  delete process.env.NODE_TEST_CONTEXT;
  const runner = hostRunner();
  const [result] = await runner.verify([{ command: "node", args: ["--test"], code: 0 }], cwd, AbortSignal.timeout(30000));
  assert.equal(result.passed, true, result.log);
  assert.equal(await fs.readFile(path.join(cwd, "ran.txt"), "utf8"), "yes", "the check ran in the folder itself");
  // Windows 의 npm 은 npm.cmd 라 셸로 띄우는 경로도 확인한다.
  await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "fixture", private: true,
    scripts: { test: "node -e \"require('fs').writeFileSync('npm.txt','yes')\"" } }));
  const [npm] = await runner.verify([{ command: "npm", args: ["test"], code: 0 }], cwd, AbortSignal.timeout(60000));
  assert.equal(npm.passed, true, npm.log);
  assert.equal(await fs.readFile(path.join(cwd, "npm.txt"), "utf8"), "yes");
  assert.ok(permitted.some(({ command, args }) => command === "python" && args.join(" ") === "-m unittest discover"));
  await assert.rejects(runner.verify([{ command: "node", args: ["-e", "1"], code: 0 }], cwd, AbortSignal.timeout(3000)), /not allowed/);
});

test("adapters report the honest host execution policy", () => {
  const runner = hostRunner({ locate: () => "/fixture/cli", launch() {}, terminate() {}, shutdown() {} });
  const agent = runner.requireAdapter({ adapter: "claude" }, { provider: "anthropic", model: "claude-sonnet-5-5" }, []);
  assert.deepEqual(agent.executionPolicy, { directory: "selected-folder", permission: "user", network: "host" });
  const missing = hostRunner({ locate: () => null, launch() {}, terminate() {}, shutdown() {} });
  assert.throws(() => missing.requireAdapter({ adapter: "omp" }, { provider: "anthropic", model: "m" }, []), /찾지 못했습니다|사용할 수 없습니다|unsupported/);
});
