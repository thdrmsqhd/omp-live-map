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

test("product desktop opens its isolated Engineering UI", { timeout: 110000 }, async () => {
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
    await page.getByRole("link", { name: "Engineering" }).click({ timeout: 15000 });
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
    await page.getByText("프로젝트 설정", { exact: true }).click();
    const form = page.locator("#project-form");
    await form.locator("[name=name]").fill("desktop fixture");
    await form.locator("[name=root]").fill(repository);
    await form.locator("[name=branch]").fill("main");
    await form.getByRole("button", { name: "등록 또는 수정" }).click();
    const registered = page.locator("#project option").filter({ hasText: "desktop fixture" });
    await registered.waitFor({ state: "attached", timeout: 8000 });
    await page.locator("#design-nav").click();
    await page.locator("#kind").selectOption("model");
    await page.locator("#payload").fill(JSON.stringify({ name: "test profile", provider: "fixture", model: "fake-1" }));
    await page.locator("#definition-save").click();
    await page.locator("#definition option").filter({ hasText: "test profile" }).waitFor({ state: "attached", timeout: 8000 });
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    await page.locator("#workflow-name").fill("CI workflow");
    const start = page.locator('.workflow-node[data-node="start"]');
    const handle = start.locator(".workflow-node-title");
    await handle.scrollIntoViewIfNeeded();
    const bounds = await handle.boundingBox();
    const originalX = await start.evaluate((node) => parseFloat(node.style.left));
    assert.ok(bounds);
    await page.mouse.move(bounds.x + 20, bounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 60, bounds.y + 45, { steps: 5 });
    await page.mouse.up();
    const moved = await start.evaluate((node) => node.style.left);
    assert.ok(parseFloat(moved) > originalX);
    await page.getByRole("button", { name: "Start · 다음 출력" }).click();
    await page.getByRole("button", { name: "End · 입력" }).click();
    await page.getByRole("button", { name: "실행 계획 확인" }).click();
    await page.locator("#workflow-order li").filter({ hasText: "End" }).waitFor();
    await page.locator("#workflow-save").click();
    await page.getByText("버전 1 저장됨", { exact: true }).waitFor();
    await page.reload();
    await registered.waitFor({ state: "attached", timeout: 8000 });
    await page.locator("#project").selectOption({ label: "desktop fixture" });
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    await page.locator("#workflow-list").selectOption({ label: "CI workflow" });
    await page.waitForFunction(() => document.querySelector("#workflow-name").value === "CI workflow");
    assert.equal(await start.evaluate((node) => node.style.left), moved);
    assert.equal(await page.locator("#workflow-edges li").count(), 1);
    await page.locator("#workflow-open-run").click();
    await page.getByLabel("실행 제목").fill("CI workflow run");
    await page.getByRole("button", { name: "저장된 버전 실행" }).click();
    await page.waitForFunction(() => document.querySelector("#workflow-run-status").textContent === "succeeded");
    assert.match(await page.locator("#workflow-run-nodes").textContent(), /End · succeeded/);
    await page.getByRole("button", { name: "개발 Task", exact: true }).click();
    const task = page.locator("#sdlc-form");
    await task.getByLabel("업무 제목").fill("CI development task");
    await task.getByLabel("요구사항").fill("Maintain the baseline");
    await task.getByLabel("Workflow 버전").selectOption({ label: "CI workflow · v1" });
    await task.getByRole("button", { name: "Task 저장" }).click();
    const card = page.locator("#sdlc-board article").filter({ hasText: "CI development task" });
    await card.getByRole("button", { name: "준비로 이동" }).click();
    await card.getByRole("button", { name: "Workflow 실행", exact: true }).click();
    await page.locator("#workflow").waitFor();
    await page.waitForFunction(() => document.querySelector("#workflow-run-list").selectedOptions[0]?.textContent === "CI development task · succeeded");
    await page.getByRole("button", { name: "실행", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Loop 실행" }).isVisible(), true);
    await verifyHarnessEditor(page, repository);
    await verifyWorkflowCanvas(page, origin);
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


async function verifyHarnessEditor(page, repository) {
  await fs.writeFile(path.join(repository, "review-rules.md"), "CI review rules.");
  execFileSync("git", ["add", "review-rules.md"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
    "commit", "-m", "Review fixture"], { cwd: repository });

  await page.getByRole("button", { name: "설계", exact: true }).click();
  await page.locator("#kind").selectOption("harness");
  await page.locator("#harness-template").selectOption("reviewer");
  await page.locator("#harness-template-use").click();
  await page.locator('[name=harnessName]').fill("CI reviewer");
  await page.locator('[name=harnessModel]').selectOption({ label: "test profile" });
  await page.locator('[name=sourceFiles]').fill("review-rules.md");
  await page.locator("#harness-preview-open").click();
  await page.getByText(/CI review rules\./).waitFor();
  await page.getByText(/현재 실행할 수 없습니다/).waitFor();
  await page.locator("#definition-save").click();
  await page.locator("#definition option").filter({ hasText: "CI reviewer" }).waitFor({ state: "attached" });
  const harnessId = await page.locator("#definition").inputValue();

  await page.locator("#workflow-nav").click();
  await page.locator("#workflow-list").selectOption("");
  await page.locator("#workflow-name").fill("CI review workflow");
  await page.locator("#workflow-type").selectOption("agent");
  await page.locator("#workflow-add").click();
  const agent = page.locator('.workflow-node[data-type="agent"]');
  const nodeId = await agent.getAttribute("data-node");
  await page.locator("[name=harnessDefinition]").selectOption(harnessId);
  await page.locator("[name=harnessVersion]").selectOption("1");
  await page.locator("[name=harnessInstruction]").fill("Review the change.");
  await page.locator("#workflow-node-form").getByRole("button", { name: "노드 적용" }).click();
  await page.locator("#workflow-edge-summary").click();
  for (const [from, to] of [["start", nodeId], [nodeId, "end"]]) {
    await page.locator("#workflow-from").selectOption(from);
    await page.locator("#workflow-to").selectOption(to);
    await page.locator("#workflow-connect").click();
  }
  await page.locator("#workflow-save").click();
  await page.getByText("버전 1 저장됨", { exact: true }).waitFor();
  const workflow = await page.locator("#workflow-list").inputValue();
  const project = await page.locator("#project").inputValue();

  await agent.locator(".workflow-node-title").click();
  await page.locator("#workflow-harness-edit").click();
  await page.locator("#harness-fields").waitFor();
  await page.locator("[name=instructions]").fill("Review changed test cases as well.");
  await page.locator("#definition-save").click();
  await page.locator("#definition-version option[value='2']").waitFor({ state: "attached" });
  await page.locator("#harness-uses summary").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "v2 적용" }).click();
  await page.getByText("Workflow v2 저장됨", { exact: true }).waitFor();
  for (const version of [1, 2]) {
    const result = await page.evaluate((params) => window.engineeringDesktop.request("workflow", params),
      { project, id: workflow, version });
    assert.equal(result.ok, true);
    assert.equal(result.value.payload.nodes.find(({ id }) => id === nodeId).version, version);
  }
  await page.locator("#harness-template").selectOption("writer");
  await page.locator("#harness-template-use").click();
  await page.locator("[name=harnessName]").fill("CI documentation");
  await page.locator('[name=harnessModel]').selectOption({ label: "test profile" });
  await page.locator("#definition-save").click();
  await page.locator("#definition option").filter({ hasText: "CI documentation" }).waitFor({ state: "attached" });
}

async function verifyWorkflowCanvas(page, origin) {
  await page.goto(origin);
  await page.locator('#viewModes button[data-mode="map"]').click();
  const open = page.locator("#workflow-new-run");
  await open.click();
  const launch = page.locator("#workflow-launch-form");
  await launch.locator('[name="project"]').selectOption({ label: "desktop fixture" });
  await launch.locator('[name="source"]').selectOption({ label: "CI workflow · v1" });
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
  await page.waitForFunction(() => document.querySelector("#workflow-map-nodes").childElementCount === 2);
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
  await page.locator("#workflow-queue").getByRole("button", { name: /Launch from the original Live Map/ }).click();
  await inspector.locator("#wf-map-title").filter({ hasText: "Launch from the original Live Map" }).waitFor();
  assert.equal(await node.evaluate((element) => element.style.left), dragged);
  assert.equal(await page.locator("#workflow-queue-toggle").getAttribute("aria-expanded"), "false");

  await inspector.getByRole("button", { name: "Workflow 편집" }).click();
  await page.locator("#wf-map-edit-controls").waitFor();
  await page.locator("#wf-edit-name").fill("CI workflow canvas version");
  await page.locator("#wf-edit-validate").click();
  await page.getByText(/검사 통과/).waitFor();
  await page.locator("#wf-edit-save").click();
  await page.getByText(/Workflow v2 저장됨/).waitFor();
  assert.match(await inspector.locator("#wf-map-version").textContent(), /v1/);
  await inspector.getByRole("button", { name: "이 Workflow로 새 실행" }).click();
  await launch.locator('[name="source"] option:checked').filter({ hasText: "CI workflow canvas version · v2" }).waitFor({ state: "attached" });
  await launch.getByRole("button", { name: "닫기", exact: true }).click();
}
