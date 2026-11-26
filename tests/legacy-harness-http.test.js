"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

async function waitForText(file, text) {
  const deadline = Date.now() + 3000;
  do {
    const content = await fs.readFile(file, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
    if (content.includes(text)) return;
    await delay(15);
  } while (Date.now() < deadline);
  assert.fail(`Fixture did not emit ${text}`);
}

test("기존 세션 API로 두 가짜 CLI를 연결하고 OMP 턴을 취소한다", { timeout: 10000 }, async (t) => {
  // Claude 세션은 호스트 가용 RAM 이 적으면 바로 띄우지 않고 '가용 RAM 부족 · 실행 대기'로 줄을 세운다(server/performance.js).
  // 이 테스트는 실행 경로를 확인하므로 RAM 이 넉넉한 호스트로 고정한다. 고정하지 않으면 RAM 사용률이 80%를 넘는 PC 에서 Claude 실행이 없어 실패한다.
  t.mock.method(os, "freemem", () => Math.floor(os.totalmem() / 2));
  const spawn = childProcess.spawn;
  const children = new Set();
  const launches = [];
  const fake = {
    omp: path.join(__dirname, "fake-omp", "fake-omp.js"),
    claude: path.join(__dirname, "fake-claude", "fake-claude.js"),
  };
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    // Windows process-tree cleanup is a real OS command, not a harness launch.
    if(command==="taskkill")return spawn(command,args,options);
    assert.ok(Object.hasOwn(fake, command), `Unexpected command: ${command}`);
    const flag = args.indexOf(command === "omp" ? "--append-system-prompt" : "--append-system-prompt-file");
    const prompt = flag === -1 ? "" : require("node:fs").readFileSync(args[flag + 1], "utf8");
    launches.push({ command, args, prompt });
    const directory = options.cwd;
    const child = spawn(process.execPath, [fake[command], ...args], {
      ...options,
      env: {
        ...process.env,
        FAKE_OMP_HOME: directory,
        FAKE_OMP_LOG: path.join(directory, "omp-rpc.jsonl"),
        FAKE_OMP_SCENARIO: path.join(__dirname, "fake-omp", "scenarios", "ask-basic.json"),
        FAKE_CLAUDE_HOME: directory,
        FAKE_CLAUDE_LOG: "",
        FAKE_CLAUDE_DELAY: "1",
      },
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    const item = { child, closed };
    children.add(item);
    child.once("close", () => children.delete(item));
    return child;
  });

  await withLegacyHttp(t, async ({ directory, request }) => {
    async function post(route, body) {
      const response = await request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, route+": "+response.text);
      const data = JSON.parse(response.text);
      assert.equal(data.ok, true, data.out);
      return data;
    }

    try {
      const toRef = ({ id, version }) => ({ id, version });
      const ompProfile = (await post("/api/session-harnesses", {
        name: "Shared OMP profile", adapter: "omp", provider: "fake", model: "fake-2", role: "Reviewer",
        instructions: "OMP profile instructions",
      })).profile;
      const omp = await post("/api/session/new", { cwd: directory, profile: toRef(ompProfile) });
      assert.match(launches.find(({ command }) => command === "omp").prompt, /Role: Reviewer\n\nOMP profile instructions/);
      assert.ok(JSON.parse((await fs.readFile(path.join(directory, "omp-rpc.jsonl"), "utf8"))
        .split("\n").find((line) => line.includes('"command":"set_model"'))).frame.success);
      await post("/api/prompt", { node: omp.node, text: "fixture prompt" });
      await waitForText(path.join(directory, "omp-rpc.jsonl"), '"type":"extension_ui_request"');
      await post("/api/prompt/cancel", { node: omp.node });
      await post("/api/session/stop", { node: omp.node });

      const claudeProfile = (await post("/api/session-harnesses", {
        name: "Shared Claude profile", adapter: "claude", model: "sonnet", instructions: "Claude profile v1 instructions",
      })).profile;
      const claude = await post("/api/session/new", { cwd: directory, profile: toRef(claudeProfile), text: "fixture prompt" });
      const claudeLaunch = launches.find(({ command }) => command === "claude");
      assert.equal(claudeLaunch.prompt, "Claude profile v1 instructions");
      assert.equal(claudeLaunch.args[claudeLaunch.args.indexOf("--model") + 1], "sonnet");
      const revised = (await post("/api/session-harnesses", { ...claudeProfile, instructions: "Claude profile v2 instructions" })).profile;
      assert.equal(revised.version, 2);
      const invalid = await request("/api/session/new", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: directory, profile: toRef(claudeProfile), text: "stale profile" }),
      });
      assert.equal(JSON.parse(invalid.text).ok, false);
      assert.equal(require("../server/harness/session-profiles").assigned(claude.node, "claude").version, 1);
      await waitForText(claude.node, '"type":"cost-state"');
      require("../server/harness/claude").scan();
      const graph = JSON.parse((await request("/api/graph")).text);
      const node = graph.sessions.flatMap((session) => session.nodes).find(({ id }) => id === claude.node);
      assert.equal(node?.harness, "claude");
      assert.match(node?.lastAssistant, /fixture prompt/);
      const list=async()=>JSON.parse((await request("/api/session/list")).text).sessions;
      async function idle(){for(let i=0;i<150;i++){const s=(await list()).find(x=>x.node===claude.node);if(s?.state==="idle"&&!s.busy)return s;await delay(20);}assert.fail("Claude stream did not become idle");}
      const first=await idle();
      await post("/api/session-harnesses", { ...toRef(revised), remove: true });
      assert.equal(require("../server/harness/session-profiles").assigned(claude.node, "claude").instructions, "Claude profile v1 instructions");
      await post("/api/prompt",{node:claude.node,text:"second fixture"});
      await waitForText(claude.node,"second fixture");
      const second=await idle();assert.equal(second.pid,first.pid,"stream must reuse same process");
      await post("/api/prompt",{node:claude.node,text:"permission fixture"});
      let ask;for(let i=0;i<150;i++){ask=require("../server/ui-requests").asksFor(claude.node)[0];if(ask)break;await delay(20);}assert.equal(ask?.method,"confirm");
      await post("/api/chat/answer",{node:claude.node,id:ask.id,response:{confirmed:true}});await idle();
      await post("/api/session/stop",{node:claude.node});
      for(let i=0;i<150;i++){if(!(await list()).some(x=>x.node===claude.node))break;await delay(20);}
      assert.equal((await list()).some(x=>x.node===claude.node),false,"stopped stream removed from registry");
    } finally {
      const remaining = [...children];
      for (const { child } of remaining) child.kill();
      await Promise.all(remaining.map(({ closed }) => closed));
      require("../server/harness/session-profiles").close();
    }
  });
});
