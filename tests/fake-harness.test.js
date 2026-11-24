"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { test } = require("node:test");

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fake-harness-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("가짜 OMP가 RPC 시작, 질문 대기, 취소 응답을 재현한다", { timeout: 8000 }, async (t) => {
  const directory = await temporaryDirectory(t);
  const fake = path.join(__dirname, "fake-omp");
  const child = spawn(process.execPath, [path.join(fake, "fake-omp.js"), "-r", path.join(directory, "session.jsonl")], {
    env: {
      ...process.env,
      FAKE_OMP_LOG: path.join(directory, "rpc.jsonl"),
      FAKE_OMP_SCENARIO: path.join(fake, "scenarios", "ask-basic.json"),
    },
    cwd: directory,
  });
  const closed = once(child, "close");
  const lines = readline.createInterface({ input: child.stdout });
  const frames = lines[Symbol.asyncIterator]();
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + "\n");
  async function waitFor(match) {
    for (let line = await frames.next(); !line.done; line = await frames.next()) {
      const frame = JSON.parse(line.value);
      if (match(frame)) return frame;
    }
    assert.fail("Expected RPC frame before stdout closed");
  }

  try {
    await waitFor((frame) => frame.type === "ready");
    send({ type: "set_ask_dialog", id: "enable", enabled: true });
    assert.equal((await waitFor((frame) => frame.id === "enable")).success, true);
    send({ type: "prompt", id: "prompt", message: "fixture" });
    await waitFor((frame) => frame.type === "extension_ui_request" && frame.method === "ask");
    send({ type: "abort", id: "abort" });
    assert.equal((await waitFor((frame) => frame.id === "abort")).success, true);
    await waitFor((frame) => frame.type === "agent_end");
    child.stdin.end();
    assert.deepEqual(await closed, [0, null]);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
});

test("가짜 Claude가 새 기록, 스트리밍 결과, CLI 오류를 재현한다", async (t) => {
  const directory = await temporaryDirectory(t);
  const fake = path.join(__dirname, "fake-claude", "fake-claude.js");
  const options = {
    cwd: directory,
    env: {
      ...process.env,
      FAKE_CLAUDE_HOME: directory,
      FAKE_CLAUDE_LOG: "",
      FAKE_CLAUDE_DELAY: "1",
    },
    input: "fixture",
    encoding: "utf8",
    timeout: 5000,
  };
  const result = spawnSync(process.execPath, [fake, "-p", "--session-id", "fixture"], options);
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const frames = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames[0].type, "system");
  assert.ok(frames.some((frame) => frame.type === "stream_event"));
  assert.equal(frames.at(-1).subtype, "success");
  const slug = directory.replace(/[^A-Za-z0-9]/g, "-");
  const file = path.join(directory, ".claude", "projects", slug, "fixture.jsonl");
  assert.match(await fs.readFile(file, "utf8"), /cost-state/);

  const failure = spawnSync(process.execPath, [fake], options);
  assert.equal(failure.status, 2, failure.error?.message);
  assert.match(failure.stderr, /-p/);
});
