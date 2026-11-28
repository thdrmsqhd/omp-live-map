"use strict";

// README 스크린샷(docs/media/v9)을 지금 화면(관제 벽 · 위쪽 막대 한 줄 · 서랍)에서 다시 만든다. CI 에서는 돌지 않는다.
//   npm install --no-save --package-lock=false playwright@1.56.1 electron@43.8.12
//   node tests/verification/readme-screenshots.cjs
// 개인 경로가 화면에 남지 않도록 데모 데이터는 모두 C:\omp-demo 아래에 만들고, 끝나면 지운다. 실제 ~/.omp · ~/.claude 는 읽지 않는다.
// 데스크톱 앱은 화면 밖·포커스 불가로 띄운다(tests/verification/desktop-launch.cjs). 모델은 부르지 않는다(승인 단계만 있는 Workflow).

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { launchDesktop } = require("./desktop-launch.cjs");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/media/v9");
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
  // 실행 중 화면(OMP_README_LIVE=1)에서 코드 리뷰가 실제로 찾을 거리가 있도록 재접속 결함을 넣어 둔다.
  write(path.join(PROJECTS.gateway, "src", "modbus-client.js"), [
    "// Modbus TCP 클라이언트: 끊기면 재접속한다.",
    "const net = require(\"node:net\");",
    "",
    "class ModbusClient {",
    "  constructor({ host, port, retryMs = 1000 }) {",
    "    this.host = host; this.port = port; this.retryMs = retryMs;",
    "    this.socket = null; this.timer = null; this.pending = new Map();",
    "  }",
    "  connect() {",
    "    this.socket = net.createConnection({ host: this.host, port: this.port });",
    "    this.socket.on(\"close\", () => this.reconnect());",
    "    this.socket.on(\"data\", (chunk) => this.onData(chunk));",
    "    return this.socket;",
    "  }",
    "  reconnect() {",
    "    this.timer = setTimeout(() => this.socket.connect(this.port, this.host), this.retryMs);",
    "  }",
    "  send(frame) { this.socket.write(frame); }",
    "  onData(chunk) {",
    "    const id = chunk.readUInt16BE(0);",
    "    this.pending.get(id)?.(chunk);",
    "    this.pending.delete(id);",
    "  }",
    "}",
    "module.exports = { ModbusClient };",
    "",
  ].join("\n"));
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
    + assistant(700, [{ type: "text", text: "test/reconnect.test.js 에 연결 끊김 시나리오를 추가했습니다." }, call("s1", "edit", { input: "[test/reconnect.test.js#4C1A]\nPUT >1:\n+test(\"poller reconnects after a dropped socket\", async () => {\n+  const client = await connectAndDrop();\n+  assert.ok(await client.reconnected(5000));\n+});\n" })], { tokens: [900, 260, 9000, 0.014] })
    + result(690, "s1", "edit", "ok")
    + assistant(520, [{ type: "text", text: "재현 테스트가 수정 전 코드에서 실패하는 것을 확인했습니다." }], { stop: "stop", tokens: [700, 140, 9500, 0.011] }));
  write(path.join(subs, "1-FixReconnect.jsonl"), head("sub-fix", PROJECTS.gateway, "FixReconnect", 790)
    + user(789, "reconnect()가 이전 타이머와 소켓을 정리하고 지수 백오프로 다시 붙도록 고치세요.")
    + assistant(600, [{ type: "text", text: "타이머 정리와 백오프를 적용합니다." }, call("s2", "edit", { input: "[src/modbus-client.js#9E2B]\nPUT 15.=17:\n+  reconnect() {\n+    clearTimeout(this.timer);\n+    this.socket?.destroy();\n+    this.timer = setTimeout(() => this.connect(), this.retryMs = Math.min(this.retryMs * 2, 30000));\n+  }\n" })], { tokens: [1000, 310, 11000, 0.016] })
    + result(590, "s2", "edit", "ok")
    + assistant(30, [{ type: "text", text: "수정을 마쳤고 재현 테스트가 통과합니다." }], { stop: "stop", tokens: [800, 120, 11500, 0.012] }));

  write(path.join(sessions, "factory-dashboard", "chart-refactor.jsonl"), head("chart-refactor", PROJECTS.dashboard, "대시보드 차트 리팩토링", 4000)
    + user(3990, "차트 컴포넌트에서 중복된 스케일 계산을 하나로 합쳐 주세요.")
    + assistant(3900, [{ type: "text", text: "scale 계산을 공용 함수로 분리하고 호출부 4곳을 교체했습니다." }, call("d1", "edit", { input: "[src/charts.js#31F0]\nPUT 1.=1:\n+// 차트 렌더링 · 스케일 계산은 scaleOf 하나로\n+const scaleOf = (values, height) => height / Math.max(1, ...values);\n" })], { tokens: [1500, 380, 15000, 0.022], model: "gpt-5.1" })
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

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

async function capture() {
  const userData = path.join(DEMO, "appdata");
  fs.mkdirSync(userData, { recursive: true });
  const app = await launchDesktop({ userDataDir: userData, args: ["--skip-v2-import"], env: { HOME, USERPROFILE: HOME,
    OMP_MAP_SESSIONS: path.join(HOME, ".omp", "agent", "sessions"), OMP_MAP_CLAUDE_PROJECTS: path.join(HOME, ".claude", "projects"),
    OMP_MAP_STATE: path.join(DEMO, "state"), OMP_MAP_CWD: path.join(DEMO, "work") } });
  const browser = await chromium.connectOverCDP(app.endpoint);
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find((item) => item.url().startsWith("http://127.0.0.1")) ?? await context.waitForEvent("page", { timeout: 15000 });
    await page.setViewportSize(VIEWPORT);
    page.on("dialog", (dialog) => void dialog.accept());
    await page.waitForFunction(() => typeof UM !== "undefined" && UM.loaded, null, { timeout: 20000 });
    const request = async (name, params, payload) => {
      const reply = await page.evaluate(([e, p, b]) => window.engineeringApi.request(e, p, b), [name, params ?? {}, payload]);
      if (!reply?.ok) throw new Error(name + ": " + JSON.stringify(reply).slice(0, 200));
      return reply.value;
    };
    const repaint = () => page.evaluate(async () => { await umapRefresh(true); await umapRefresh(true); paintUmap(true); umapFit(true); });
    // 두 폴더를 프로젝트로 만들고, modbus-gateway 에 계획 승인 Task 를 하나 돌려 승인 대기로 둔다(모델 호출 없음).
    const gateway = (await request("projects/ensure", {}, { root: PROJECTS.gateway })).id;
    await request("projects/ensure", {}, { root: PROJECTS.dashboard });
    const flow = await request("workflows", {}, { project: gateway, payload: { name: "계획 승인",
      nodes: [{ id: "start", label: "Start", type: "start", x: 0, y: 0 },
        { id: "approve", label: "계획 승인", type: "approval", prompt: "재접속 수정 계획을 검토해 주세요", x: 300, y: 0 },
        { id: "end", label: "End", type: "end", x: 600, y: 0 }],
      edges: [{ from: "start", to: "approve", port: "next" }, { from: "approve", to: "end", port: "approved" }] } });
    const task = await request("tasks", {}, { project: gateway, text: "Modbus 재접속 수정 · 계획 승인", workflow: flow.id, version: flow.version });
    await request("tasks/run", {}, { id: task.id, key: "readme-demo" });
    await request("tasks", {}, { project: gateway, text: "poller 주기 설정을 환경 변수로", template: "feature" });
    await repaint();
    await page.locator(".um-stage.s-waiting_approval").first().waitFor({ timeout: 20000 });
    await sleep(1200);
    await shot(page, "01-wall.png");
    const key = "project:" + gateway;
    await page.evaluate((k) => umapEnterFocus(k), key);
    await sleep(1200);
    await shot(page, "02-project-full.png");
    const card = page.locator(".um-stage.s-waiting_approval").first();
    await card.screenshot({ path: path.join(OUT, "03-approval.png") });
    await page.evaluate((id) => openTaskDrawer(id), task.id);
    await page.locator("#umap-drawer-body .um-prop", { hasText: "예산" }).waitFor();
    await sleep(600);
    await shot(page, "04-task-drawer.png");
    await page.keyboard.press("Escape");
    await page.evaluate(() => umapLeaveFocus());
    await sleep(800);
    await page.locator("#topbar-more").click();
    await page.locator(".inline-menu").waitFor();
    await sleep(400);
    await shot(page, "05-topbar-menu.png");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 768, height: 1000 });
    await repaint();
    await sleep(1200);
    await shot(page, "06-narrow-768.png");
  } finally {
    await browser.close().catch(() => {});
    await app.stop();
  }
}

(async () => {
  fs.rmSync(DEMO, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  seedProjects();
  seedOmpSessions();
  seedClaudeSession();
  try {
    await capture();
  } finally {
    await sleep(500);
    fs.rmSync(DEMO, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
