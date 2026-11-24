"use strict";

const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

test("engineering API requires its desktop token and preserves the original graph", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-api-"));
  const token = randomBytes(32).toString("hex");
  process.env.OMP_MAP_ENGINEERING_TOKEN = token;
  process.env.OMP_MAP_ENGINEERING_DATA = directory;
  try {
    await withLegacyHttp(t, async ({ request }) => {
      assert.equal((await request("/api/graph")).status, 200);
      assert.equal((await request("/api/engineering/projects")).status, 403);
      const headers = { "x-omp-engineering-token": token };
      const response = await request("/api/engineering/capabilities", { headers });
      assert.deepEqual(JSON.parse(response.text), { omp: false, claude: false });
      assert.equal(process.env.OMP_MAP_ENGINEERING_TOKEN, undefined);
      assert.equal((await request("/api/engineering/projects", {
        headers: { ...headers, origin: "https://example.invalid" },
      })).status, 403);
      const bad = await request("/api/engineering/definitions", {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "[]",
      });
      assert.equal(bad.status, 400);
    });
  } finally {
    delete process.env.OMP_MAP_ENGINEERING_DATA;
    // The server owns the connection for the life of this isolated test process.
    if (process.platform !== "win32") await fs.rm(directory, { recursive: true, force: true });
  }
});
