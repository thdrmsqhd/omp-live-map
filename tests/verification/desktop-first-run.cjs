"use strict";

// 데스크톱 첫 실행: 빈 사용자 데이터로 앱을 열면 설계 화면의 '처음 쓰기' 안내가 보이고,
// 폴더 선택(메인 프로세스 대화상자) → 등록 → 기본 구성 → 기본 Workflow → 첫 Workflow 열기까지 페이지 이동 없이 끝난다.
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
    await steps.getByRole("button", { name: "폴더 선택" }).click();
    await steps.locator("li[data-done='1']", { hasText: "프로젝트 등록" }).waitFor({ timeout: 15000 });
    await steps.getByRole("button", { name: "기본 구성 추가" }).click();
    await steps.locator("li[data-done='1']", { hasText: "기본 구성" }).waitFor({ timeout: 15000 });
    await steps.getByRole("button", { name: "기본 Workflow 8종 추가" }).click();
    await steps.locator("li[data-done='1']", { hasText: "기본 Workflow" }).waitFor({ timeout: 15000 });
    await steps.getByRole("button", { name: "열기" }).click();
    await page.locator("#studio-workflow option:checked", { hasText: "버그 수정" }).waitFor({ state: "attached", timeout: 15000 });
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
