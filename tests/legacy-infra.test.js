"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

test("WSL 및 Docker 인벤토리·제어 API의 형식과 대상 검증을 유지한다", (t) => {
  const commands = [];
  const container = {
    ID: "container-fixture",
    Names: "edge-service",
    Image: "example",
    State: "running",
    Labels: "com.docker.compose.project=edge,com.docker.compose.service=gateway",
  };
  t.mock.method(childProcess, "spawn", (command, args) => {
    assert.equal(command, "wsl");
    commands.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const listing = Buffer.from("  NAME            STATE           VERSION\r\n* FixtureLinux    Running         2\r\n", "utf16le");
    const output = args[0] === "-l" ? listing :
      args[2] === "ps" ? Buffer.from(JSON.stringify(container) + "\n") : Buffer.from("ok\n");
    process.nextTick(() => {
      child.stdout.emit("data", output);
      child.emit("close", 0);
    });
    return child;
  });

  return withLegacyHttp(t, async ({ request }) => {
    const inventory = await request("/api/infra");
    assert.equal(inventory.status, 200);
    const { distros, projects } = JSON.parse(inventory.text);
    assert.deepEqual(distros, [{ name: "FixtureLinux", state: "Running", version: 2 }]);
    assert.deepEqual(projects, [{ name: "edge", up: 1, total: 1, compose: true }]);

    async function action(kind, target) {
      const result = await request("/api/infra/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, target }),
      });
      assert.equal(result.status, 200);
      return JSON.parse(result.text);
    }

    assert.equal((await action("container-restart", "unknown")).ok, false);
    assert.equal(commands.length, 2);
    assert.equal((await action("container-restart", container.ID)).ok, true);
    assert.deepEqual(commands[2], ["-e", "docker", "restart", container.ID]);
    assert.equal((await action("distro-stop", "FixtureLinux")).ok, true);
    assert.deepEqual(commands[5], ["--terminate", "FixtureLinux"]);
  });
});
