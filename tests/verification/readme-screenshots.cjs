"use strict";

// README 스크린샷을 실제 실행 화면에서 다시 만든다. CI 에서는 돌지 않는다.
//   npm install --no-save --package-lock=false playwright@1.56.1 electron@43.8.12 monaco-editor@0.52.2
//   node tests/verification/readme-screenshots.cjs [main|engineering|all]
// 개인 경로가 화면에 남지 않도록 데모 데이터는 모두 C:\omp-demo 아래에 만들고, 끝나면 지운다.
// main: 가짜 omp·Claude Code 세션 기록을 둔 HOME 으로 서버를 띄워 관제·워크스페이스·Live Map 을 찍는다.
// engineering: 같은 HOME 으로 데스크톱 앱(Electron)을 띄워 Engineering 화면을 찍는다.

const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/media/v8");
const DEMO = path.join(process.env.SystemDrive || "C:", "omp-demo");
const HOME = path.join(DEMO, "home");
const PROJECTS = { gateway: path.join(DEMO, "work", "modbus-gateway"), dashboard: path.join(DEMO, "work", "factory-dashboard") };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VIEWPORT = { width: 1440, height: 900 };

const iso = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const line = (record) => JSON.stringify(record) + "\n";

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function seedProjects() {
  write(path.join(PROJECTS.gateway, "src", "modbus-client.js"), "// Modbus TCP 클라이언트\nmodule.exports = { connect() {}, reconnect() {} };\n");
  write(path.join(PROJECTS.gateway, "src", "poller.js"), "// 주기 폴링\nmodule.exports = { start() {} };\n");
  write(path.join(PROJECTS.gateway, "test", "reconnect.test.js"), "// 재접속 회귀 테스트\n");
  write(path.join(PROJECTS.gateway, "README.md"), "# modbus-gateway\n");
  write(path.join(PROJECTS.dashboard, "src", "charts.js"), "// 차트 렌더링\n");
  write(path.join(PROJECTS.dashboard, "README.md"), "# factory-dashboard\n");
  for (const root of Object.values(PROJECTS)) {
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Demo", "-c", "user.email=demo@example.invalid", "commit", "-m", "init"], { cwd: root, stdio: "ignore" });
  }
}

const usage = (input, output, cacheRead, cost) => ({ input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: { total: cost } });
const user = (secondsAgo, text) => line({ type: "message", timestamp: iso(secondsAgo), message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (secondsAgo, content, { stop = "toolUse", tokens = [1800, 420, 22000, 0.031], model = "claude-sonnet-4-6" } = {}) => line({
  type: "message", timestamp: iso(secondsAgo),
  message: { role: "assistant", provider: "anthropic", model, stopReason: stop, duration: 6400, ttft: 820, usage: usage(...tokens), content },
});
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const result = (secondsAgo, id, name, text, isError = false) => line({
  type: "message", timestamp: iso(secondsAgo),
  message: { role: "toolResult", toolCallId: id, toolName: name, isError, content: [{ type: "text", text }] },
});

function seedOmpSessions() {
  const sessions = path.join(HOME, ".omp", "agent", "sessions");
  const folder = path.join(sessions, "modbus-gateway");
  const main = path.join(folder, "reconnect-fix.jsonl");
  const head = (id, cwd, title, secondsAgo) => line({ type: "session", id, timestamp: iso(secondsAgo), cwd }) + line({ type: "title", title, timestamp: iso(secondsAgo) });
  write(main, head("reconnect-fix", PROJECTS.gateway, "Modbus 재접속 오류 수정", 900)
    + user(880, "PLC 연결이 끊긴 뒤 poller가 다시 붙지 않습니다. 원인을 찾고 재현 테스트와 함께 고쳐 주세요.")
    + assistant(860, [{ type: "text", text: "재접속 경로부터 확인하겠습니다. 클라이언트와 poller를 같이 읽고, 끊김을 재현하는 테스트를 먼저 만들겠습니다." },
      call("c1", "read", { path: "src/modbus-client.js" }), call("c2", "read", { path: "src/poller.js" })])
    + result(850, "c1", "read", "module.exports = { connect() {}, reconnect() {} };")
    + result(849, "c2", "read", "module.exports = { start() {} };")
    + assistant(800, [{ type: "text", text: "reconnect()가 타이머를 정리하지 않아 이전 소켓이 남습니다. 서브에이전트에게 재현 테스트와 수정을 나눠 맡기겠습니다." },
      call("c3", "task", { tasks: [{ name: "ReproduceDrop", agent: "task" }, { name: "FixReconnect", agent: "task" }] })], { tokens: [2600, 640, 31000, 0.047] })
    + result(420, "c3", "task", "ReproduceDrop: 재현 테스트 추가 완료\nFixReconnect: 타이머 정리 후 지수 백오프 적용")
    + assistant(300, [{ type: "text", text: "두 작업이 끝났습니다. 전체 테스트를 돌려 확인합니다." }, call("c4", "bash", { command: "node --test" })], { tokens: [3100, 380, 38000, 0.052] })
    + result(240, "c4", "bash", "ℹ tests 24\nℹ pass 24\nℹ fail 0")
    + assistant(60, [{ type: "text", text: "재접속이 5초 안에 복구되도록 고쳤고, 끊김을 재현하는 회귀 테스트(`test/reconnect.test.js`)를 추가했습니다. 테스트 24건이 모두 통과합니다." }],
      { stop: "stop", tokens: [3300, 520, 41000, 0.058] }));
  const subs = path.join(folder, "reconnect-fix");
  write(path.join(subs, "0-ReproduceDrop.jsonl"), head("sub-repro", PROJECTS.gateway, "ReproduceDrop", 790)
    + user(789, "소켓을 강제로 끊어 poller가 복구하지 못하는 상황을 재현하는 테스트를 추가하세요.")
    + assistant(700, [{ type: "text", text: "test/reconnect.test.js 에 연결 끊김 시나리오를 추가했습니다." }, call("s1", "edit", { path: "test/reconnect.test.js" })], { tokens: [900, 260, 9000, 0.014] })
    + result(690, "s1", "edit", "ok")
    + assistant(520, [{ type: "text", text: "재현 테스트가 수정 전 코드에서 실패하는 것을 확인했습니다." }], { stop: "stop", tokens: [700, 140, 9500, 0.011] }));
  write(path.join(subs, "1-FixReconnect.jsonl"), head("sub-fix", PROJECTS.gateway, "FixReconnect", 790)
    + user(789, "reconnect()가 이전 타이머와 소켓을 정리하고 지수 백오프로 다시 붙도록 고치세요.")
    + assistant(600, [{ type: "text", text: "타이머 정리와 백오프를 적용합니다." }, call("s2", "edit", { path: "src/modbus-client.js" })], { tokens: [1000, 310, 11000, 0.016] })
    + result(590, "s2", "edit", "ok")
    + assistant(30, [{ type: "text", text: "수정을 마쳤고 재현 테스트가 통과합니다." }], { stop: "stop", tokens: [800, 120, 11500, 0.012] }));

  write(path.join(sessions, "factory-dashboard", "chart-refactor.jsonl"), head("chart-refactor", PROJECTS.dashboard, "대시보드 차트 리팩토링", 4000)
    + user(3990, "차트 컴포넌트에서 중복된 스케일 계산을 하나로 합쳐 주세요.")
    + assistant(3900, [{ type: "text", text: "scale 계산을 공용 함수로 분리하고 호출부 4곳을 교체했습니다." }, call("d1", "edit", { path: "src/charts.js" })], { tokens: [1500, 380, 15000, 0.022], model: "gpt-5.1" })
    + result(3890, "d1", "edit", "ok")
    + assistant(3800, [{ type: "text", text: "리팩토링을 마쳤습니다. 동작 변경은 없습니다." }], { stop: "stop", tokens: [1200, 210, 16000, 0.018], model: "gpt-5.1" }));
  // 세션 상태는 파일 수정 시각으로 정해지므로 이 세션은 한 시간 전에 끝난 것으로 둔다.
  const idle = new Date(Date.now() - 3800 * 1000);
  fs.utimesSync(path.join(sessions, "factory-dashboard", "chart-refactor.jsonl"), idle, idle);
}

function seedClaudeSession() {
  const cwd = PROJECTS.dashboard;
  const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const file = path.join(HOME, ".claude", "projects", slug, "claude-demo-1.jsonl");
  const claudeUsage = { input_tokens: 2100, output_tokens: 540, cache_read_input_tokens: 26000, cache_creation_input_tokens: 0 };
  write(file, line({ type: "custom-title", customTitle: "알람 목록 필터 추가", timestamp: iso(500) })
    + line({ type: "user", cwd, timestamp: iso(480), message: { role: "user", content: "알람 목록에 심각도 필터를 추가해 주세요." } })
    + line({ type: "assistant", cwd, timestamp: iso(420), message: { role: "assistant", model: "claude-opus-4-5", usage: claudeUsage,
      content: [{ type: "text", text: "알람 목록 컴포넌트를 확인한 뒤 필터를 추가하겠습니다." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/charts.js" } }] } })
    + line({ type: "user", cwd, timestamp: iso(410), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "// 차트 렌더링" }] } })
    + line({ type: "assistant", cwd, timestamp: iso(45), message: { role: "assistant", model: "claude-opus-4-5", usage: claudeUsage,
      content: [{ type: "text", text: "심각도 필터(전체·경고·위험)를 추가했고 선택 상태를 URL에 보존합니다." }] } })
    + line({ type: "cost-state", totalCostUSD: 0.19, timestamp: iso(40) }));
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, "server.js"), "--port", "0", "--hours", "24"], {
    env: { ...process.env, HOME, USERPROFILE: HOME, OMP_MAP_STATE: path.join(DEMO, "state"), OMP_MAP_CWD: path.join(DEMO, "work") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [chunk] = await once(child.stdout, "data");
  const port = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) throw new Error("server did not report a port");
  return { child, url: "http://127.0.0.1:" + port };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

async function captureMain() {
  const { child, url } = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url);
    await page.waitForSelector("#overview .mon-card", { timeout: 15000 });
    await page.getByRole("button", { name: "2시간", exact: true }).first().click();
    await page.setViewportSize({ width: 1440, height: 1080 });
    await sleep(2000);
    await shot(page, "01-overview.png");
    await page.setViewportSize(VIEWPORT);

    await page.locator('[data-mode="workspace"]').click();
    await page.locator("#slList .sl-row.main .nm", { hasText: "Modbus 재접속 오류 수정" }).first().click();
    await page.waitForSelector(".node.big.active-card", { timeout: 10000 });
    await sleep(2500);
    await shot(page, "02-workspace.png");

    await page.locator('[data-mode="map"]').click();
    for (const title of ["Modbus 재접속 오류 수정", "알람 목록 필터 추가"]) {
      await page.locator("#slList .sl-row.main .nm", { hasText: title }).first().click();
      await sleep(600);
    }
    await sleep(1500);
    await page.locator("#slList .sl-row.main", { hasText: "대시보드 차트 리팩토링" }).locator("button, .x").first().click().catch(() => {});
    await page.setViewportSize({ width: 1920, height: 1080 });
    await sleep(1500);
    await page.getByRole("button", { name: "fit", exact: true }).click().catch(() => {});
    await page.locator("#layout-preset").selectOption("horizontal").catch(() => {});
    await page.locator("#layout-apply").click().catch(() => {});
    await sleep(1200);
    for (let i = 0; i < 2; i++) { await page.getByRole("button", { name: "fit", exact: true }).click().catch(() => {}); await sleep(1500); }
    await shot(page, "03-live-map.png");
  } finally {
    await browser.close();
    child.kill();
  }
}

async function captureEngineering() {
  const electron = require("electron");
  const userData = path.join(DEMO, "appdata");
  fs.mkdirSync(userData, { recursive: true });
  const app = spawn(electron, [path.join(ROOT, "desktop"), "--remote-debugging-port=0", "--user-data-dir=" + userData, "--skip-v2-import"], {
    env: { ...process.env, HOME, USERPROFILE: HOME, OMP_MAP_STATE: path.join(DEMO, "state"), OMP_MAP_CWD: path.join(DEMO, "work") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const endpoint = await new Promise((resolve, reject) => {
    app.stderr.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-4000);
      const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    app.once("close", (code) => reject(new Error("Desktop exited: " + code)));
    setTimeout(() => reject(new Error("Desktop did not expose its debug port")), 20000).unref();
  });
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 15000 });
    await page.setViewportSize(VIEWPORT);
    await page.waitForLoadState("load");
    const step = async (name, fn) => {
      try { await fn(); } catch (error) { console.error("[skip] " + name + ": " + error.message.split("\n")[0]); await page.screenshot({ path: path.join(process.env.TEMP, "debug-" + name.replace(/\W+/g, "_") + ".png") }).catch(() => {}); }
    };
    const click = (name, exact = true) => page.getByRole("button", { name, exact }).click();
    const request = async (endpointName, params, payload) => {
      const reply = await page.evaluate(([e, p, b]) => window.engineeringDesktop.request(e, p, b), [endpointName, params ?? {}, payload]);
      if (!reply?.ok) throw new Error(endpointName + ": " + JSON.stringify(reply).slice(0, 200));
      return reply.value;
    };

    await page.getByRole("link", { name: "Engineering" }).click({ timeout: 15000 });
    await page.getByRole("heading", { name: "기초 생성" }).waitFor();
    await page.locator("#setup-defaults").click();
    await page.locator("#setup-starter-status").filter({ hasText: "개인 기본 구성이 준비됐습니다." }).waitFor();
    await sleep(600);

    await click("Workflow");
    await page.getByText("프로젝트 설정", { exact: true }).click();
    const form = page.locator("#project-form");
    await form.locator("[name=name]").fill("modbus-gateway");
    await form.locator("[name=root]").fill(PROJECTS.gateway);
    await form.locator("[name=branch]").fill("main");
    await form.getByRole("button", { name: "등록 또는 수정" }).click();
    await page.locator("#project option").filter({ hasText: "modbus-gateway" }).waitFor({ state: "attached" });
    await page.getByText("프로젝트 설정", { exact: true }).click();
    await page.locator("#project").selectOption({ label: "modbus-gateway" });
    await page.locator("#setup-nav").click();
    await step("프로필", async () => {
      await page.locator("#session-harnesses-nav").click();
      await sleep(1500);
      await page.locator("#session-harness-list").selectOption({ label: "기본 · 심층 디버깅 · v1" });
      await sleep(1000);
      await shot(page, "11-engineering-profile.png");
    });
    await step("하네스", async () => {
      await page.locator("#design-nav").click();
      await sleep(1500);
      await page.locator("#definition option").first().waitFor({ state: "attached", timeout: 8000 });
      await page.locator("#definition").selectOption({ label: "기본 · Node 개발" }).catch(() => {});
      await sleep(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "12-engineering-harness.png");
    });
    await step("루프", async () => {
      await page.locator("#loop-nav").click();
      await sleep(1500);
      await page.locator("#definition").selectOption({ label: "기능 개발 · Node" }).catch(() => {});
      await sleep(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "17-engineering-loop.png");
    });
    await step("Workflow 캔버스", async () => {
      await page.locator("#project").selectOption({ label: "modbus-gateway" }).catch(() => {});
      await click("Workflow");
      await page.getByText("기본 제공 Workflow", { exact: true }).click();
      const preset = page.locator("#workflow-preset-form");
      await preset.locator("[name=preset]").selectOption("bugfix");
      console.log("preset loop (bugfix):", (await preset.locator("[name=loop] option:checked").textContent()).trim());
      await preset.locator("[name=preset]").selectOption("tests");
      console.log("preset loop (tests):", (await preset.locator("[name=loop] option:checked").textContent()).trim());
      await preset.locator("[name=preset]").selectOption("bugfix");
      await preset.locator("[name=name]").fill("Modbus 버그 수정");
      await preset.locator("[name=create]").click();
      await page.locator("#workflow-list option").filter({ hasText: "Modbus 버그 수정" }).waitFor({ state: "attached" });
      await page.getByText("기본 제공 Workflow", { exact: true }).click().catch(() => {});
      await sleep(1200);
      await page.locator("#workflow-fit").click().catch(() => {});
      await sleep(800);
      await shot(page, "13-engineering-workflow.png");
    });
    await step("개발 Task", async () => {
      await click("개발 Task");
      const task = page.locator("#sdlc-form");
      await task.getByLabel("업무 제목").fill("Modbus 재접속 오류 수정");
      await task.getByLabel("요구사항").fill("PLC 연결이 끊긴 뒤 5초 안에 자동으로 다시 접속한다. 재현 테스트를 포함한다.");
      await task.getByLabel("Workflow 버전").selectOption({ index: 1 });
      await task.getByRole("button", { name: "Task 저장" }).click();
      await page.locator("#sdlc-board article").filter({ hasText: "Modbus 재접속 오류 수정" }).waitFor();
      await page.locator("#sdlc-board article").filter({ hasText: "Modbus 재접속 오류 수정" }).getByRole("button", { name: "준비로 이동" }).click().catch(() => {});
      await sleep(1000);
      await shot(page, "14-engineering-tasks.png");
    });
    await step("승인 실행(관제 Live Map)", async () => {
      const projects = await request("projects", {});
      const project = projects.find((item) => item.name === "modbus-gateway");
      const saved = await request("workflows", {}, { project: project.id, payload: { name: "계획 승인 데모",
        nodes: [{ id: "start", label: "Start", type: "start", x: 35, y: 90 },
          { id: "approve", label: "계획 승인", type: "approval", prompt: "재접속 수정 계획을 검토해 주세요.", x: 295, y: 90 },
          { id: "end", label: "End", type: "end", x: 555, y: 90 }],
        edges: [{ from: "start", to: "approve", port: "next" }, { from: "approve", to: "end", port: "approved" }] } });
      await request("workflow-runs", {}, { key: "readme-demo", project: project.id, workflow: saved.id, version: saved.version ?? 1,
        title: "Modbus 재접속 수정 · 계획 승인", timeoutMs: 600000, budgetCents: 0 });
      await page.goto(new URL("/", page.url()).href);
      await page.locator('[data-mode="overview"]').click();
      await page.getByRole("button", { name: "2시간", exact: true }).first().click();
      await page.waitForSelector("#overview .mon-card", { timeout: 15000 });
      await page.setViewportSize({ width: 1440, height: 1080 });
      await sleep(2500);
      await shot(page, "15-overview-engineering.png");
      await page.setViewportSize(VIEWPORT);
      await page.locator('[data-mode="map"]').click();
      await sleep(1500);
      await page.getByRole("button", { name: /개입 필요/ }).first().click();
      await sleep(800);
      await page.getByText("Modbus 재접속 수정 · 계획 승인").first().click();
      await sleep(3500);
      await shot(page, "16-live-map-workflow.png");
    });
  } finally {
    await browser.close().catch(() => {});
    app.kill();
  }
}

(async () => {
  const mode = process.argv[2] ?? "all";
  fs.rmSync(DEMO, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  seedProjects();
  seedOmpSessions();
  seedClaudeSession();
  try {
    if (mode === "main" || mode === "all") await captureMain();
    if (mode === "engineering" || mode === "all") await captureEngineering();
  } finally {
    await sleep(500);
    fs.rmSync(DEMO, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
