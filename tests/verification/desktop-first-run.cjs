"use strict";

// 데스크톱 첫 실행: 빈 사용자 데이터로 앱을 열면 설계 화면의 '바로 실행' 패널이 보이고,
// 작업 폴더 목록의 '다른 폴더…'(메인 프로세스 대화상자) → 등록 → 할 일 8종 표시 → 목표를 적으면 '실행' 활성까지 페이지 이동 없이 끝난다(실행은 누르지 않는다).
// 렌더러는 대화상자에서 고르지 않은 경로를 등록할 수 없다.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const executable = require("electron");

test("desktop first run registers a picked folder and opens a built-in workflow", { timeout: 120000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-first-run-"));
  const repository = path.join(directory, "picked-repo");
  await fs.mkdir(repository);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-q", "--allow-empty", "-m", "start"], { cwd: repository });
  const app = spawn(executable, [path.resolve(__dirname, "../../desktop"), "--remote-debugging-port=0",
    "--user-data-dir=" + path.join(directory, "user"), "--skip-v2-import"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, OMP_MAP_TEST_PICK_FOLDER: repository } });
  const closed = once(app, "close");
  closed.catch(() => {});
  let browser, output = "";
  try {
    const endpoint = await Promise.race([
      new Promise((resolve) => app.stderr.on("data", (chunk) => {
        output = (output + chunk).slice(-8000);
        const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
        if (match) resolve(match[1]);
      })),
      closed.then(([code]) => { throw new Error("Desktop exited: " + code + "\n" + output); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Desktop did not expose its test port")), 20000).unref()),
    ]);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 15000 });
    await page.waitForFunction(() => typeof mapMode !== "undefined" && mapMode === "design", null, { timeout: 30000 });
    const panel = page.locator("#first-run");
    await panel.waitFor({ timeout: 15000 });

    // 고르지 않은 경로는 등록되지 않는다.
    const denied = await page.evaluate((root) => window.engineeringDesktop.request("projects/register-picked", {}, { root }), path.join(directory, "other"));
    assert.equal(denied.ok, false);

    const steps = panel.locator("#first-run-steps");
    const folder = steps.getByLabel("작업 폴더");
    await folder.waitFor({ timeout: 15000 });
    await folder.selectOption("pick:");
    await page.waitForFunction(() => document.querySelector("#first-run-steps select[aria-label='작업 폴더']")?.value.includes("picked-repo"), null, { timeout: 15000 });
    const choices = steps.locator(".first-run-presets button");
    await choices.nth(7).waitFor({ timeout: 15000 });
    assert.equal(await choices.count(), 8);
    assert.equal(await steps.locator(".first-run-presets button", { hasText: "버그 수정" }).getAttribute("aria-pressed"), "true");
    const run = steps.getByRole("button", { name: "실행", exact: true });
    await steps.getByLabel("작업 목표").fill("로그인 버튼이 반응하지 않는다. 원인을 찾아 고친다.");
    assert.equal(await run.isEnabled(), true);
    assert.equal(new URL(page.url()).pathname, "/");
    // 대화상자에서 받은 경로는 한 번만 쓸 수 있다.
    const again = await page.evaluate((root) => window.engineeringDesktop.request("projects/register-picked", {}, { root }), repository);
    assert.equal(again.ok, false);
  } finally {
    await browser?.close().catch(() => {});
    app.kill();
    await closed.catch(() => {});
  }
});
