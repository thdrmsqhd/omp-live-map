"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
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
  const spawn = childProcess.spawn;
  const children = new Set();
  const fake = {
    omp: path.join(__dirname, "fake-omp", "fake-omp.js"),
    claude: path.join(__dirname, "fake-claude", "fake-claude.js"),
  };
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    // Windows process-tree cleanup is a real OS command, not a harness launch.
    if(command==="taskkill")return spawn(command,args,options);
    assert.ok(Object.hasOwn(fake, command), `Unexpected command: ${command}`);
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
      const omp = await post("/api/session/new", { cwd: directory, harness: "omp" });
      await post("/api/prompt", { node: omp.node, text: "fixture prompt" });
      await waitForText(path.join(directory, "omp-rpc.jsonl"), '"type":"extension_ui_request"');
      await post("/api/prompt/cancel", { node: omp.node });
      await post("/api/session/stop", { node: omp.node });

      const claude = await post("/api/session/new", { cwd: directory, harness: "claude", text: "fixture prompt" });
      await waitForText(claude.node, '"type":"cost-state"');
      require("../server/harness/claude").scan();
      const graph = JSON.parse((await request("/api/graph")).text);
      const node = graph.sessions.flatMap((session) => session.nodes).find(({ id }) => id === claude.node);
      assert.equal(node?.harness, "claude");
      assert.match(node?.lastAssistant, /fixture prompt/);
      const list=async()=>JSON.parse((await request("/api/session/list")).text).sessions;
      async function idle(){for(let i=0;i<150;i++){const s=(await list()).find(x=>x.node===claude.node);if(s?.state==="idle"&&!s.busy)return s;await delay(20);}assert.fail("Claude stream did not become idle");}
      const first=await idle();
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
    }
  });
});
