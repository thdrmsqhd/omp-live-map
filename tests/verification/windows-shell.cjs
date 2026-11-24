"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("../helpers/legacy-http");

test("existing terminal API executes Git Bash in the Windows workspace", (t) =>
  withLegacyHttp(t, async ({ directory, request }) => {
    const response = await request("/api/exec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: directory, cmd: "printf 'git-bash-ok' > evidence.txt && cat evidence.txt" }),
    });
    const result = JSON.parse(response.text);
    assert.equal(response.status, 200);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /git-bash-ok/);
    assert.equal(await fs.readFile(path.join(directory, "evidence.txt"), "utf8"), "git-bash-ok");
  }));
