"use strict";

// 데스크톱 앱(Electron) 통합 흐름 — 지금 화면 그대로(탭 없음, 관제 벽 + 서랍):
//   프로젝트 타일 ⋯ > 프로젝트 문서(README 요약이 서랍에) → ＋ Task 한 줄로 Task 만들기(Enter) → ▶ → 승인 카드 → 반려(이유 한 줄)
//   → 실행 실패 · 개입 필요에 그 단계 → 다시 ▶ → 승인 → 완료(쉬는 타일의 최근 끝난 일 목록에 완료로 보인다).
// 창은 화면 밖·포커스 불가(tests/verification/desktop-launch.cjs). 필요: playwright(connectOverCDP), electron.
//   node --test tests/verification/unified-workflow-desktop.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { launchDesktop } = require("./desktop-launch.cjs");

test("Desktop: README context, ＋ Task line, approval reject → attention → approve → done on the wall", { timeout: 120000 }, async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "unified-desktop-"));
  const root = path.join(data, "repo");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "README.md"), "# 통합 관제 검증 프로젝트\n\n## 목적\n실제 실행과 승인을 한 화면에서 검증합니다.\n\n## 현황\n승인 게이트를 확인합니다.\n");
  for (const args of [["init", "-b", "main"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]]) {
    execFileSync("git", args, { cwd: root, windowsHide: true });
  }
  const app = await launchDesktop({ userDataDir: data });
  let browser;
  try {
    browser = await chromium.connectOverCDP(app.endpoint);
    const context = browser.contexts()[0];
    const page = context.pages().find((item) => item.url().startsWith("http://127.0.0.1")) ?? await context.waitForEvent("page");
    await page.setViewportSize({ width: 1480, height: 1050 });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.waitForFunction(() => typeof UM !== "undefined" && UM.loaded);
    const request = async (name, params, body) => {
      const result = await page.evaluate(([n, p, b]) => window.engineeringApi.request(n, p, b), [name, params ?? {}, body]);
      assert.equal(result.ok, true, `${name}: ${result.error}`);
      return result.value;
    };
    const project = (await request("projects/ensure", {}, { root })).id;
    const flow = await request("workflows", {}, { project, payload: { name: "검증 결과 승인", nodes: [
      { id: "start", type: "start", label: "시작", x: 0, y: 0 },
      { id: "review", type: "approval", label: "결과 검토", prompt: "작업 결과를 확인하고 승인하세요.", x: 330, y: 0 },
      { id: "end", type: "end", label: "완료", x: 680, y: 0 }],
    edges: [{ from: "start", to: "review", port: "next" }, { from: "review", to: "end", port: "approved" }] } });
    const key = "project:" + project;
    // 이미 도는 가벼운 갱신(SSE)이 있으면 umapRefresh(true) 가 그것을 돌려주므로 한 번 더 받아 새 Workflow 까지 싣는다.
    await page.evaluate(async () => { await umapRefresh(true); await umapRefresh(true); paintUmap(true); });
    const tile = page.locator(`.um-tile[data-band="${key}"]`);
    await tile.waitFor();

    // 프로젝트 문서: 타일 ⋯ > 프로젝트 문서 → README 요약이 서랍에.
    await tile.locator('[data-um="band-menu"]').click();
    await page.locator(".inline-menu button", { hasText: "프로젝트 문서" }).click();
    await page.locator("#unified-project-context").getByText("실제 실행과 승인을 한 화면에서 검증합니다.", { exact: false }).first().waitFor();
    await page.keyboard.press("Escape");

    // ＋ Task 한 줄: 글 + Workflow 칩(저장된 Workflow 선택) → Enter.
    await tile.locator('[data-um="add-task"]').click();
    const line = page.locator(".um-add-text");
    await line.waitFor();
    await page.locator(".um-add-line select").selectOption("flow:" + flow.id);
    await line.fill("실제 승인 경로 검증");
    await line.press("Enter");
    let task;
    for (const deadline = Date.now() + 15000; !task; await new Promise((r) => setTimeout(r, 300))) {
      task = (await request("task-map", { project })).tasks.find(({ title }) => title === "실제 승인 경로 검증");
      assert.ok(task || Date.now() < deadline, "the ＋ Task line creates the task");
    }
    assert.deepEqual(task.stages.map(({ label }) => label), ["결과 검토"], "the Task uses the chosen Workflow: " + task.workflow?.name);
    await page.evaluate((k) => umapRefresh(true).then(() => { paintUmap(true); umapEnterFocus(k); }), key);
    const runTask = () => page.locator(`.um-task[data-task="${task.id}"] [data-um="run"]`).click();
    const waitStatus = async (status) => {
      for (const deadline = Date.now() + 30000; ;) {
        const run = (await request("task-map", { project })).tasks.find(({ id }) => id === task.id).run;
        if (run?.status === status) return run;
        assert.ok(Date.now() < deadline, "run reaches " + status + " (now " + run?.status + ")");
        await new Promise((r) => setTimeout(r, 400));
      }
    };
    const approval = page.locator(`.um-stage.s-waiting_approval[data-task="${task.id}"]`);

    // ▶ → 승인 카드 → 반려(이유) → 실패 · 개입 필요.
    await runTask();
    await approval.waitFor({ timeout: 30000 });
    assert.equal((await approval.locator(".um-approve-prompt").innerText()).trim(), "작업 결과를 확인하고 승인하세요.");
    await approval.locator('[data-um="reject"]').click();
    const reason = page.locator(".inline-edit");
    await reason.fill("테스트 결과가 빠졌습니다");
    await reason.press("Enter");
    await waitStatus("failed");
    await page.evaluate(() => umapRefresh(true).then(() => paintUmap(true)));
    await page.locator("#umap-attention", { hasText: /개입 필요 [1-9]/ }).waitFor();

    // 다시 ▶ → 승인 → 완료.
    await page.evaluate(() => umapRefresh(true).then(() => paintUmap(true)));
    await runTask();
    await approval.waitFor({ timeout: 30000 });
    await approval.locator('[data-um="approve"]').click();
    await waitStatus("succeeded");

    // 벽으로 돌아오면 쉬는 타일의 최근 끝난 일 목록에 완료로 보인다(펼침 단추 없음).
    await page.evaluate(() => { umapLeaveFocus(); return umapRefresh(true).then(() => paintUmap(true)); });
    const done = tile.locator(".um-done li", { hasText: "실제 승인 경로 검증" });
    await done.waitFor();
    assert.match(await done.innerText(), /완료/);
    assert.equal(await tile.locator("button", { hasText: /펼치기|접기|더 보기/ }).count(), 0);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`${error.message}\nElectron output:\n${app.output()}`, { cause: error });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await app.stop();
    await fs.rm(data, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
});
