"use strict";

const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const executable = require("electron");

test("product desktop opens its isolated Engineering UI", { timeout: 45000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-desktop-"));
  const installed = process.env.OMP_MAP_INSTALLED_EXE;
  const args = installed ? [] : [path.resolve(__dirname, "../../desktop")];
  const app = spawn(installed || executable, [...args, "--remote-debugging-port=0", "--user-data-dir=" + directory],
    { stdio: ["ignore", "pipe", "pipe"] });
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
    if (installed) {
      const monaco = await fetch("http://127.0.0.1:7800/vendor/monaco/vs/loader.js");
      assert.equal(monaco.status, 200);
      assert.match(monaco.headers.get("content-type"), /javascript/);
    }
    await page.getByRole("button", { name: "실행 환경 준비" }).waitFor({ timeout: 8000 });
    await page.waitForFunction(() => Boolean(document.querySelector("#runtime-status")?.textContent));
    const testKey = "sk-ant-v2-fixture-12345678901234567890";
    await page.locator("#provider-key input").fill(testKey);
    await page.getByRole("button", { name: "키 저장" }).click();
    await page.getByText("Windows 사용자 비밀 저장소에 키를 저장했습니다.").waitFor();
    const storedKey = path.join(directory, "anthropic-key.dpapi");
    assert.equal((await fs.readFile(storedKey)).includes(Buffer.from(testKey)), false);
    await page.getByRole("button", { name: "키 삭제" }).click();
    await page.getByText("저장된 키를 삭제했습니다.").waitFor();
    await assert.rejects(fs.stat(storedKey), { code: "ENOENT" });
    const repository = path.join(directory, "fixture-repo");
    await fs.mkdir(repository);
    for (const command of [["init", "-b", "main"], ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
      "commit", "--allow-empty", "-m", "start"]]) execFileSync("git", command, { cwd: repository });
    const form = page.locator("#project-form");
    await form.locator("[name=name]").fill("desktop fixture");
    await form.locator("[name=root]").fill(repository);
    await form.locator("[name=branch]").fill("main");
    await form.getByRole("button", { name: "등록 또는 수정" }).click();
    const registered = page.locator("#project option").filter({ hasText: "desktop fixture" });
    await registered.waitFor({ state: "attached", timeout: 8000 });
    await page.locator("#payload").fill(JSON.stringify({ name: "test profile", provider: "fixture", model: "fake-1" }));
    await page.getByRole("button", { name: "버전 저장" }).click();
    await page.locator("#definition option").filter({ hasText: "test profile" }).waitFor({ state: "attached", timeout: 8000 });
    await page.reload();
    await registered.waitFor({ state: "attached", timeout: 8000 });
    await page.locator("#project").selectOption({ label: "desktop fixture" });
    await page.locator("#definition option").filter({ hasText: "test profile" }).waitFor({ state: "attached", timeout: 8000 });
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
