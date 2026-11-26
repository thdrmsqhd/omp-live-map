"use strict";

const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const executable = require("electron");

test("product desktop opens its isolated Engineering UI", { timeout: 180000 }, async () => {
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
  const existingStarted = once(existing, "listening");
  existing.listen(7800, "127.0.0.1");
  await existingStarted;
  const installed = process.env.OMP_MAP_INSTALLED_EXE;
  const args = installed ? [] : [path.resolve(__dirname, "../../desktop")];
  const app = spawn(installed || executable, [...args, "--remote-debugging-port=0", "--user-data-dir=" + directory,
    "--import-v2-data-dir=" + legacy],
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
    // 확인 창(하네스 새 버전 적용, Claude Code 로그인이 곧 만료되는 PC 의 실행 시작 확인)은 모두 수락한다.
    page.on("dialog", (dialog) => void dialog.accept());
    // Engineering 설정 페이지: 이전 데이터 가져오기, 실행 환경, 키 저장소, 프로젝트 등록.
    await page.getByRole("link", { name: "Engineering" }).click({ timeout: 15000 });
    await page.locator("#sdlc-nav").waitFor();
    const origin = new URL(page.url()).origin;
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(origin, "http://127.0.0.1:7800");
    if (installed) {
      const monaco = await fetch(origin + "/vendor/monaco/vs/loader.js");
      assert.equal(monaco.status, 200);
      assert.match(monaco.headers.get("content-type"), /javascript/);
      const ant = path.join(path.dirname(installed), "resources", "runtime", "vendor", "ant", "ant.exe");
      assert.match(execFileSync(ant, ["--version"], { encoding: "utf8", timeout: 10000 }), /2\.13\.0/);
    }
    // 폼 화면(프로필·하네스·루프·Workflow)은 없다.
    for (const removed of ["#setup-nav", "#design-nav", "#loop-nav", "#workflow-nav", "#session-harnesses-nav"]) {
      assert.equal(await page.locator(removed).count(), 0, removed);
    }
    await page.getByText("실행 환경", { exact: true }).click();
    await page.locator("#prepare-runtime").waitFor({ timeout: 8000 });
    await page.waitForFunction(() => Boolean(document.querySelector("#runtime-status")?.textContent));
    await page.locator("#project option").filter({ hasText: "CI V2 project" }).waitFor({ state: "attached" });
    const login = page.getByRole("button", { name: "Claude Console 로그인" });
    assert.equal(await login.isVisible(), true);
    if (installed) assert.equal(await login.isEnabled(), true);
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
    await fs.writeFile(path.join(repository, "review-rules.md"), "CI review rules.");
    execFileSync("git", ["add", "review-rules.md"], { cwd: repository });
    execFileSync("git", ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-m", "Review fixture"], { cwd: repository });
    await page.getByText("프로젝트 설정", { exact: true }).click();
    const form = page.locator("#project-form");
    await form.locator("[name=name]").fill("desktop fixture");
    await form.locator("[name=root]").fill(repository);
    await form.locator("[name=branch]").fill("main");
    await form.getByRole("button", { name: "등록 또는 수정" }).click();
    await page.locator("#project option").filter({ hasText: "desktop fixture" }).waitFor({ state: "attached", timeout: 8000 });
    const request = async (endpoint, params, payload) => {
      const result = await page.evaluate(([name, query, body]) => window.engineeringDesktop.request(name, query, body), [endpoint, params ?? {}, payload]);
      assert.equal(result.ok, true, endpoint + ": " + result.error);
      return result.value;
    };
    const project = (await request("projects")).find(({ name }) => name === "desktop fixture").id;
    // 관제 화면의 설계 모드에서는 프로젝트 등록 같은 설정 쓰기를 막는다.
    await page.goto(origin + "/?mode=design&project=" + project);

    // 설계 모드(관제 화면 안 노드 캔버스): 기본 구성 → 노드와 연결선.
    await page.locator("#design").waitFor();
    const denied = await page.evaluate(() => window.engineeringDesktop.request("projects", {}, { name: "x", root: "C:\\x" }));
    assert.equal(denied.ok, false);
    // 빈 캔버스 안내의 버튼은 프로필이 이미 있으면 보이지 않으므로 + 노드 메뉴의 빠른 시작을 쓴다.
    await page.locator("#studio-add").click();
    await page.getByRole("menuitem", { name: /기본 구성 추가/ }).click();
    await page.locator('.studio-node[data-kind="harness"]').first().waitFor({ timeout: 15000 });
    await page.locator('#studio-lines g[data-type="model"]').first().waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => mapMode), "design");
    assert.equal(await page.locator("#stage").isVisible(), false);

    // 정의는 노드에서 만들고 저장한다: 새 모델 노드.
    await page.locator("#studio-add").click();
    await page.getByRole("menuitem", { name: /^새 모델/ }).click();
    const model = page.locator('.studio-node[data-kind="model"].is-selected');
    await model.locator(".studio-field", { hasText: "이름" }).locator("input").fill("test profile");
    await model.locator(".studio-field", { hasText: "모델" }).locator("select").selectOption({ label: "claude-sonnet-4-6 · anthropic" });
    await page.keyboard.press("Control+s");
    await page.locator("#studio-status").filter({ hasText: "저장됨" }).waitFor();
    const testModel = (await request("definitions", { scope: "personal" })).find(({ kind, name }) => kind === "model" && name === "test profile");
    assert.ok(testModel);

    // Workflow: Start → End 를 만들고 캔버스에서 옮긴 위치를 새 버전으로 저장한다.
    const created = await request("workflows", {}, { project, payload: { name: "CI workflow", nodes: [
      { id: "start", label: "Start", type: "start", x: 0, y: 40 }, { id: "end", label: "End", type: "end", x: 420, y: 40 }],
    edges: [{ from: "start", to: "end", port: "next" }] } });
    await page.goto(origin + "/?mode=design&project=" + project + "&workflow=" + created.id);
    const start = page.locator('.studio-node[data-key="step:start"]');
    await start.waitFor({ timeout: 15000 });
    const handle = start.locator(".studio-head");
    const bounds = await handle.boundingBox();
    const originalX = await start.evaluate((node) => parseFloat(node.style.left));
    assert.ok(bounds);
    await page.mouse.move(bounds.x + 30, bounds.y + 10);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 90, bounds.y + 40, { steps: 6 });
    await page.mouse.up();
    const moved = await start.evaluate((node) => parseFloat(node.style.left));
    assert.ok(moved > originalX);
    await page.locator("#studio-check").click();
    await page.locator("#studio-status").filter({ hasText: "검사 통과" }).waitFor();
    await page.locator("#studio-save").click();
    await page.locator("#studio-status").filter({ hasText: "v2 저장" }).waitFor();
    const savedFlow = await request("workflow", { project, id: created.id });
    assert.equal(savedFlow.version, 2);
    assert.ok(savedFlow.payload.nodes.find(({ id }) => id === "start").x > 0);

    await verifyHarnessDetail(page, request, project, testModel);
    await verifyLiveMap(page, origin, project);

    // 개발 Task 는 Engineering 페이지에서 만들고 실행하면 관제에서 그 실행을 연다.
    await page.goto(origin + "/engineering.html?project=" + project);
    await page.locator("#sdlc-nav").click();
    const task = page.locator("#sdlc-form");
    await task.getByLabel("업무 제목").fill("CI development task");
    await task.getByLabel("요구사항").fill("Maintain the baseline");
    await task.getByLabel("Workflow 버전").selectOption({ label: "CI workflow · v2" });
    await task.getByRole("button", { name: "Task 저장" }).click();
    const card = page.locator("#sdlc-board article").filter({ hasText: "CI development task" });
    await card.getByRole("button", { name: "준비로 이동" }).click();
    await card.getByRole("button", { name: "Workflow 실행", exact: true }).click();
    await page.locator("#wf-map-title").filter({ hasText: "CI development task" }).waitFor({ timeout: 15000 });
    await page.locator("#wf-map-status").filter({ hasText: /^완료$/ }).waitFor();
    await page.goto(origin + "/engineering.html?view=execution");
    assert.equal(await page.getByRole("heading", { name: "Loop 실행" }).isVisible(), true);
    // 예전 폼 화면 주소는 관제의 설계 모드로 간다.
    await page.goto(origin + "/engineering.html?view=design");
    await page.locator("#design").waitFor();
    const unauthenticated = await fetch(origin + "/api/engineering/projects");
    assert.equal(unauthenticated.status, 403);
    const foreignOrigin = await fetch(origin + "/api/graph", { headers: { origin: "http://127.0.0.1:7800" } });
    assert.equal(foreignOrigin.status, 403);
    await page.close();
    const [code] = await closed;
    assert.equal(code, 0);
    const source = new DatabaseSync(path.join(legacy, "engineering.sqlite"), { readOnly: true });
    try { assert.equal(source.prepare("PRAGMA user_version").get().user_version, 1); } finally { source.close(); }
    await assert.rejects(fetch(origin + "/api/graph"), /fetch failed/);
    assert.equal(await (await fetch("http://127.0.0.1:7800")).text(), "existing service");
  } catch (error) {
    throw new Error(`${error.message}\nElectron stderr:\n${output}`, { cause: error });
  } finally {
    existing.close();
    existing.closeAllConnections();
    if (app.exitCode === null && app.signalCode === null) app.kill();
    await closed.catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

// 하네스 노드 상세: 실제 적용값(저장소 자료), 사용 중인 Workflow 에 새 버전 적용.
async function verifyHarnessDetail(page, request, project, testModel) {
  // 기본 하네스 하나를 본떠 저장소 자료(review-rules.md)를 읽는 하네스를 만든다.
  const base = (await request("definitions", { scope: "personal" })).find(({ kind, name }) => kind === "harness" && name === "기본 · 코드 리뷰");
  const harness = await request("definitions", {}, { scope: "personal", kind: "harness", payload: { ...base.payload, name: "CI reviewer", model: testModel.id,
    instructions: "Review the change.", assets: { ...base.payload.assets, files: ["review-rules.md"], inputs: [] } } });
  const flow = await request("workflows", {}, { project, payload: { name: "CI review workflow", nodes: [
    { id: "start", label: "Start", type: "start", x: 0, y: 40 },
    { id: "review", label: "Review", type: "agent", definition: harness.id, version: 1, instruction: "Review the change.", x: 200, y: 40 },
    { id: "end", label: "End", type: "end", x: 420, y: 40 }],
  edges: [{ from: "start", to: "review", port: "next" }, { from: "review", to: "end", port: "next" }] } });
  await request("definitions", {}, { scope: "personal", kind: "harness", id: harness.id, version: 1,
    payload: { ...harness.payload, instructions: "Review changed test cases as well." } });
  await page.goto(page.url().split("?")[0] + "?mode=design&project=" + project);
  const node = page.locator('.studio-node[data-kind="harness"]', { hasText: "CI reviewer" }).first();
  await node.waitFor({ timeout: 15000 });
  await node.locator(".studio-more").click();
  await page.getByRole("menuitem", { name: /상세 · 버전 기록 · 실제 적용값/ }).click();
  const panel = page.locator("#studio-inspect");
  await panel.getByText("버전 기록 · 최신 v2").waitFor();
  await panel.locator("summary", { hasText: "실제 적용값" }).click();
  await panel.getByRole("button", { name: "편집 중 초안" }).click();
  await panel.getByText(/CI review rules\./).waitFor();
  // CI 에는 실행 환경이 없어 실행할 수 없다고 나오고, 실행 환경이 있는 PC 에서는 준비 완료로 나온다.
  await panel.getByText(/현재 실행할 수 없습니다|실행 준비 완료/).waitFor();
  await panel.locator("summary", { hasText: "사용 중인 Workflow" }).click();
  await panel.getByRole("button", { name: "v2 적용" }).click();
  await page.locator("#studio-status").filter({ hasText: "Workflow v2 저장됨" }).waitFor();
  const updated = await request("workflow", { project, id: flow.id });
  assert.equal(updated.version, 2);
  assert.equal(updated.payload.nodes.find(({ id }) => id === "review").version, 2);
}

// 관제(Live Map): 새 실행 → 완료 → 노드 이동 → 닫기·다시 열기(개입 필요 함의 최근 실행) → 설계에서 편집 → 관제에서 실행.
async function verifyLiveMap(page, origin, project) {
  await page.goto(origin + "/?mode=map");
  await page.locator('#viewModes button[data-mode="map"][aria-pressed="true"]').waitFor();
  const launch = page.locator("#workflow-launch-form");
  await page.locator("#workflow-new-run").click();
  await launch.locator('[name="project"]').selectOption({ label: "desktop fixture" });
  await launch.locator('[name="source"]').selectOption({ label: "CI workflow · v2" });
  await launch.locator('[name="goal"]').fill("Launch from the original Live Map");
  await launch.locator('[name="acceptance"]').fill("The graph completes and the original positions remain draggable.");
  await launch.getByRole("button", { name: "실행 시작" }).click();
  await page.getByRole("heading", { name: "Launch from the original Live Map" }).waitFor();
  const viewBefore = await page.evaluate(() => ({ ...wfMap.previousView }));
  const inspector = page.locator("#workflow-inspector");
  await inspector.locator("#wf-map-status").filter({ hasText: /^완료$/ }).waitFor();
  const node = page.locator('.wf-node[data-workflow-node="start"]');
  await node.click();
  await inspector.getByRole("heading", { name: "Start · 완료" }).waitFor();
  const before = await node.evaluate((element) => element.style.left);
  const bounds = await node.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + 18, bounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 57, bounds.y + 30, { steps: 4 });
  await page.mouse.up();
  const dragged = await node.evaluate((element) => element.style.left);
  assert.notEqual(dragged, before);

  await page.locator("#wf-map-close").click();
  await page.waitForFunction((previous) => ["x", "y", "k"].every((key) => Math.abs(view[key] - previous[key]) < 0.001), viewBefore);
  await page.locator("#workflow-queue-toggle").click();
  const queue = page.locator("#workflow-queue");
  await queue.locator("summary", { hasText: "최근 실행" }).click();
  await queue.getByRole("button", { name: /Launch from the original Live Map/ }).click();
  await inspector.locator("#wf-map-title").filter({ hasText: "Launch from the original Live Map" }).waitFor();
  assert.equal(await node.evaluate((element) => element.style.left), dragged);
  assert.equal(await page.locator("#workflow-queue-toggle").getAttribute("aria-expanded"), "false");

  await inspector.getByRole("link", { name: "설계에서 편집" }).click();
  await page.waitForFunction(() => mapMode === "design");
  await page.locator("#studio-workflow option:checked").filter({ hasText: "CI workflow · v2" }).waitFor({ state: "attached" });
  await page.locator("#studio-run").click();
  await launch.locator('[name="source"] option:checked').filter({ hasText: "CI workflow · v2" }).waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => mapMode), "map");
  await launch.getByRole("button", { name: "닫기", exact: true }).click();
}
