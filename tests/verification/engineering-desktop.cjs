"use strict";

// 데스크톱 앱(Electron) 제품 화면 검증 — 지금 화면 그대로: 탭 없음, 관제 벽(프로젝트 타일 격자), 위쪽 막대 한 줄 + ⋯ 메뉴, 오른쪽 서랍.
//   1) V2 데이터 가져오기 · 7800 포트의 기존 서비스는 건드리지 않음
//   2) 위쪽 막대 한 줄(1440px), 예전 탭·도구 막대·폼 화면 없음, ⋯ 메뉴 → 라이브러리 서랍
//   3) 등록한 프로젝트에 승인 단계가 있는 Task 를 만들고 Task 카드의 ▶ → 승인 카드(안내 한 줄이면 빈 줄 없음) → 승인 → 완료
//   4) 돈은 한 단위(₩), Task 서랍의 예산도 ₩
//   5) 보호 API(토큰 없는 요청·다른 출처 거부), 예전 주소 넘김, 창을 닫으면 로컬 서버도 끝남
// 창은 화면 밖·포커스 불가로 띄운다(tests/verification/desktop-launch.cjs). 필요: playwright(connectOverCDP 만 쓴다), electron.
//   node tests/verification/engineering-desktop.cjs
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { launchDesktop } = require("./desktop-launch.cjs");

test("product desktop: one wall, one-row top bar, approval run from a Task card, ₩ money, protected API", { timeout: 180000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-desktop-"));
  const legacy = path.join(directory, "v2-fixture");
  await fs.mkdir(legacy);
  const previous = new DatabaseSync(path.join(legacy, "engineering.sqlite"));
  try {
    previous.exec(await fs.readFile(path.resolve(__dirname, "../../server/engineering/schema.sql"), "utf8"));
    previous.exec("PRAGMA user_version=1");
    previous.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("imported-v2", legacy, "CI V2 project", "main");
  } finally { previous.close(); }
  const existing = http.createServer((_, res) => res.end("existing service"));
  existing.on("error", () => {}); // 이 PC 에서 7800 이 이미 쓰이고 있으면 그 서비스를 그대로 둔다
  const existingStarted = once(existing, "listening");
  existing.listen(7800, "127.0.0.1");
  await existingStarted.catch(() => {});
  const app = await launchDesktop({ userDataDir: directory, args: ["--import-v2-data-dir=" + legacy] });
  let browser;
  try {
    browser = await chromium.connectOverCDP(app.endpoint);
    const context = browser.contexts()[0];
    const page = context.pages().find((item) => item.url().startsWith("http://127.0.0.1")) ?? await context.waitForEvent("page", { timeout: 15000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    // 실행 환경 확인 창(이 PC 에 CLI 가 없을 때 '그래도 실행할까요?')은 수락한다. 승인 단계만 있는 Workflow 는 CLI 없이 끝난다.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.waitForFunction(() => typeof UM !== "undefined" && UM.loaded && document.querySelector("#umap-items"));
    const origin = new URL(page.url()).origin;
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(origin, "http://127.0.0.1:7800");

    // 2) 탭·설계 캔버스·칸반·폼·맵 도구 막대는 없다. 위쪽 막대는 한 줄이다.
    for (const removed of ["#viewModes", "#engineering", "#design", "#umap-tools", "#topbar .zoom", "#umap-library", "#setup-nav", "#sdlc-nav", "#workflow-launch-form"]) {
      assert.equal(await page.locator(removed).count(), 0, removed + " should not exist");
    }
    assert.equal((await page.locator("#workflow-new-run").innerText()).trim(), "＋ Task");
    const bar = await page.evaluate(() => {
      const top = document.getElementById("topbar"), shown = [...top.children].filter((el) => el.getBoundingClientRect().width > 0);
      const rects = shown.map((el) => el.getBoundingClientRect());
      return { height: top.getBoundingClientRect().height, spread: Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top)), overflow: top.scrollWidth - top.clientWidth };
    });
    assert.ok(bar.height <= 56 && bar.spread < 20 && bar.overflow <= 0, "top bar is one row: " + JSON.stringify(bar));
    await page.locator("#topbar-more").click();
    await page.locator(".inline-menu button", { hasText: "라이브러리" }).click();
    await page.locator("#umap-drawer-title", { hasText: "라이브러리" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#umap-drawer").waitFor({ state: "hidden" });

    const request = async (endpoint, params, payload) => {
      const result = await page.evaluate(([name, query, body]) => window.engineeringApi.request(name, query, body), [endpoint, params ?? {}, payload]);
      assert.equal(result.ok, true, endpoint + ": " + result.error);
      return result.value;
    };
    // 1) V2 데이터 가져오기.
    assert.ok((await request("projects")).some(({ name }) => name === "CI V2 project"), "the V2 project is imported");

    // 3) 승인 단계 Workflow 를 가진 Task 를 만들고 카드의 ▶ 로 실행 → 승인 카드 → 승인.
    const repository = path.join(directory, "fixture-repo");
    await fs.mkdir(repository);
    for (const command of [["init", "-b", "main"], ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "--allow-empty", "-m", "start"]]) {
      execFileSync("git", command, { cwd: repository, windowsHide: true });
    }
    const project = (await request("projects/ensure", {}, { root: repository })).id;
    const flow = await request("workflows", {}, { project, payload: { name: "CI 승인", nodes: [
      { id: "start", type: "start", label: "Start", x: 0, y: 0 },
      { id: "review", type: "approval", label: "결과 검토", prompt: "결과를 보고 승인하세요", x: 300, y: 0 },
      { id: "end", type: "end", label: "End", x: 600, y: 0 }],
    edges: [{ from: "start", to: "review", port: "next" }, { from: "review", to: "end", port: "approved" }] } });
    const task = await request("tasks", {}, { project, text: "CI 승인 경로", workflow: flow.id, version: flow.version });
    // 쉬는 타일(아직 도는 일이 없는 새 프로젝트)은 머리와 최근 끝난 일만 보이므로 그 프로젝트를 전체 화면으로 열어 Task 카드를 누른다.
    await page.evaluate((key) => umapRefresh(true).then(() => { paintUmap(true); umapEnterFocus(key); }), "project:" + project);
    const card = page.locator(`.um-task[data-task="${task.id}"]`);
    await card.waitFor();
    await card.locator('[data-um="run"]').click();
    const approval = page.locator(`.um-stage.s-waiting_approval[data-task="${task.id}"]`);
    await approval.waitFor({ timeout: 30000 });
    assert.equal((await approval.locator(".um-approve-prompt").innerText()).trim(), "결과를 보고 승인하세요");
    const fit = await approval.evaluate((el) => {
      const box = el.getBoundingClientRect(), buttons = el.querySelector(".um-approve").getBoundingClientRect(), prompt = el.querySelector(".um-approve-prompt").getBoundingClientRect();
      return { below: box.bottom - buttons.bottom, gap: buttons.top - prompt.bottom, clipped: el.scrollHeight - el.clientHeight };
    });
    assert.ok(fit.below <= 20 && fit.gap <= 12 && fit.clipped <= 2, "a one-line approval card has no empty line: " + JSON.stringify(fit));
    assert.match(await page.locator("#umap-attention").innerText(), /개입 필요 [1-9]/);
    await approval.locator('[data-um="approve"]').click();
    for (const deadline = Date.now() + 30000; ;) {
      const map = await request("task-map", { project });
      if (map.tasks.find(({ id }) => id === task.id)?.run?.status === "succeeded") break;
      assert.ok(Date.now() < deadline, "the approved run completes");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 4) 돈은 ₩ 한 단위.
    await page.evaluate(() => umapRefresh(true).then(() => paintUmap(true)));
    assert.equal((await page.locator("#umap").innerText()).includes("$"), false, "no dollar amounts on the wall");
    await page.evaluate((id) => openTaskDrawer(id), task.id);
    const budget = page.locator("#umap-drawer-body .um-prop", { hasText: "예산" });
    await budget.waitFor();
    assert.match(await budget.innerText(), /₩[\d,]+/);
    await page.keyboard.press("Escape");
    assert.deepEqual(pageErrors, []);

    // 5) 보호 API · 예전 주소.
    const redirected = await fetch(origin + "/engineering.html", { redirect: "manual" });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get("location"), "/");
    assert.equal((await fetch(origin + "/api/engineering/projects")).status, 403);
    assert.equal((await fetch(origin + "/api/graph", { headers: { origin: "http://127.0.0.1:7800" } })).status, 403);
    await page.close();
    const [code] = await app.closed;
    assert.equal(code, 0);
    const source = new DatabaseSync(path.join(legacy, "engineering.sqlite"), { readOnly: true });
    try { assert.equal(source.prepare("PRAGMA user_version").get().user_version, 1); } finally { source.close(); }
    await assert.rejects(fetch(origin + "/api/graph"), /fetch failed/);
    if (existing.listening) assert.equal(await (await fetch("http://127.0.0.1:7800")).text(), "existing service");
  } catch (error) {
    throw new Error(`${error.message}\nElectron output:\n${app.output()}`, { cause: error });
  } finally {
    existing.close();
    existing.closeAllConnections();
    if (browser) await browser.close().catch(() => {});
    await app.stop();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
