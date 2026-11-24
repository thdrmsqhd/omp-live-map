"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const executable = require("electron");

test("product desktop opens its isolated Engineering UI", { timeout: 45000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-desktop-"));
  const app = spawn(executable, [path.resolve(__dirname, "../../desktop"),
    "--remote-debugging-port=0", "--user-data-dir=" + directory], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(app, "close");
  closed.catch(() => {});
  let browser;
  let output = "";
  try {
    const endpoint = await Promise.race([
      new Promise((resolve) => {
        app.stderr.on("data", (chunk) => {
          output = (output + chunk.toString()).slice(-8000);
          const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
          if (match) resolve(match[1]);
        });
      }),
      closed.then(([code]) => { throw new Error("Desktop exited: " + code); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Desktop did not expose its test port")), 15000).unref()),
    ]);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 15000 });
    await page.getByRole("link", { name: "Engineering" }).click({ timeout: 15000 });
    await page.getByText("격리 검증을 통과한 실행 하네스가 없습니다.", { exact: false }).waitFor({ timeout: 8000 });
    await page.getByRole("button", { name: "실행", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Loop 실행" }).isVisible(), true);
    const unauthenticated = await fetch("http://127.0.0.1:7800/api/engineering/projects");
    assert.equal(unauthenticated.status, 403);
    await page.close();
    const [code] = await closed;
    assert.equal(code, 0);
    await assert.rejects(fetch("http://127.0.0.1:7800/api/graph"), /fetch failed/);
  } catch (error) {
    throw new Error(`${error.message}\nElectron stderr:\n${output}`, { cause: error });
  } finally {
    if (app.exitCode === null && app.signalCode === null) app.kill();
    await closed.catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
