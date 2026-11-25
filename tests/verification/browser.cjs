"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { withLegacyHttp } = require("../helpers/legacy-http");

test("existing map opens a session card, restores panel state and renders updates",
  { timeout: 50000 }, (t) => withLegacyHttp(t, async ({ directory, config }) => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    try {
      const editorFixture = "editor-fixture.txt";
      const file = path.join(directory, editorFixture);
      await fs.writeFile(file, "original text");
      const cdn = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/";
      const assets = path.join(path.dirname(require.resolve("monaco-editor/package.json")), "min");
      await page.route(cdn + "**", (route) => {
        const relative = new URL(route.request().url()).pathname.split("/min/")[1];
        if (!relative || !/^vs\/[A-Za-z0-9_./-]+$/.test(relative) || relative.split("/").includes("..")) return route.abort();
        return route.fulfill({ path: path.join(assets, relative), headers: { "access-control-allow-origin": "*" } });
      });
      const { scan } = require("../../server/tail");
      const { broadcast } = require("../../server/sse");
      const folder = path.join(config.SESSIONS, "timing");
      await fs.mkdir(folder, { recursive: true });
      const fileOf = (i) => path.join(folder, `session-${i}.jsonl`);
      const seed = (i) => {
        const timestamp = new Date().toISOString();
        const records = [
          { type: "session", id: `session-${i}`, timestamp, cwd: directory },
          { type: "title", title: `Timing ${i}`, timestamp },
        ];
        return fs.writeFile(fileOf(i), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
      };
      await Promise.all(Array.from({ length: 10 }, (_, i) => seed(i)));
      scan();
      const filter = { timeout: 8000 };
      await page.goto(`http://127.0.0.1:${config.PORT}`);
      const sessionName = (title) => page.getByText(title, { exact: true }).and(page.locator("#slList .sl-row.main .nm"));
      const first = sessionName("Timing 0");
      await page.waitForSelector("#overview .mon-card",filter);
      assert.equal(await page.locator("#overview .mon-card").count(),10);
      await page.locator('[data-mode="workspace"]').click();
      await first.click(filter);
      await page.waitForSelector("#slList .sl-row.open", filter);
      await page.waitForFunction(() => document.querySelector("#nodes").innerText.includes("Timing 0"), null, filter);
      assert.equal(await page.locator(".node.big.active-card [data-blk=editor]").count(),0);
      assert.equal(await page.locator(".node.big.active-card .card-summary>div").count(),6);
      assert.equal(await page.locator(".node.big.active-card .card-metrics-detail").isVisible(),false);
      await page.locator(".node.big.active-card [data-metrics-toggle]").click();
      assert.equal(await page.locator(".node.big.active-card .card-metrics-detail").isVisible(),true);
      await page.locator(".node.big.active-card [data-metrics-toggle]").click();
      await page.locator(".node.big.active-card [data-card-editor]").click();
      const explorerFile = page.locator("#nodes .exr").filter({ hasText: editorFixture });
      await explorerFile.click(filter);
      await page.waitForFunction(() => document.querySelector("#nodes .view-lines")?.innerText.includes("original"), null, filter);
      await page.locator("#nodes .view-lines").click(filter);
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText("updated through Monaco");
      const saved = page.waitForResponse((response) => response.url().endsWith("/api/editor/write") && response.ok());
      await page.keyboard.press("Control+S");
      assert.equal((await (await saved).json()).ok, true);
      assert.equal(await fs.readFile(file, "utf8"), "updated through Monaco");

      await page.locator("#slToggle").click();
      const connected = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/events" && response.ok());
      await page.reload();
      await connected;
      await page.waitForSelector("#sessions.collapsed", filter);
      await page.locator("#slToggle").click();
      await page.waitForFunction(() => document.querySelectorAll("#slList .sl-row.main").length === 10, null, filter);

      await fs.mkdir("artifacts/v4-ux",{recursive:true});
      // V4 modes, drafts, layout and card lifecycle.
      await page.locator('[data-mode="workspace"]').click();
      await first.click(filter);
      await page.locator(".node.big.active-card .cin").fill("unsent fixture");
      assert.equal(await page.locator(".node.big.active-card [data-send]").isEnabled(),true);
      assert.equal(await page.evaluate(()=>localStorage.getItem("omp-map-draft-v1:"+activeCardId)),JSON.stringify("unsent fixture"));
      await page.locator(".node.big.active-card .prompt-secondary summary").click();
      await page.locator(".node.big.active-card [data-prompt-action=preview]").click();
      assert.equal(await page.locator(".node.big.active-card .prompt-preview").isVisible(),true);
      await page.locator(".node.big.active-card [data-prompt-action=preview]").click();
      assert.equal(await page.locator(".node.big.active-card .chat-search").isVisible(),false);
      await page.locator(".node.big.active-card [data-chat-search-toggle]").click();
      await page.locator(".node.big.active-card .chat-search").fill("no matching fixture");
      await page.waitForFunction(()=>document.querySelector(".node.big.active-card .cmsgs")?.textContent.trim()==="검색 결과 없음",null,filter);
      assert.equal(await page.locator(".node.big.active-card .cmsgs").textContent(),"검색 결과 없음");
      await page.locator(".node.big.active-card [data-chat-search-clear]").click();
      for(const count of [1,4,8,16]){
        const load=await page.evaluate(async count=>{const ids=Array.from({length:count},(_,i)=>"perf-fixture-"+i);const t=performance.now();for(const id of ids){handleChatEvent({node:id,kind:"req",text:"load fixture",turnId:"load-"+id});for(let i=0;i<100;i++)handleChatEvent({node:id,kind:"delta",text:"한글 streaming data ".repeat(40)});}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const lengths=ids.map(id=>chatState(id).stream.length);for(const id of ids){handleChatEvent({node:id,kind:"done",turnId:"load-"+id});CHAT.delete(id);}return {ms:performance.now()-t,lengths};},count);
        assert.equal(load.lengths.length,count);assert.ok(load.lengths.every(n=>n>50000));console.log(count+" concurrent fixture streams:",load.ms.toFixed(1),"ms");
      }
      const perf=await page.evaluate(()=>fetch("/api/performance").then(r=>r.json()));assert.ok(perf.current.memory.rss>0);console.log("Backend RSS bytes:",perf.current.memory.rss,"heap:",perf.current.memory.heapUsed);
      await page.locator('[data-mode="overview"]').click();
      await page.waitForSelector("#overview .mon-card",filter);
      assert.equal(await page.locator("#overview .mon-card").count(),10);
      assert.equal(await page.locator("#overview .mon-card .mon-resources").count(),10);
      await page.screenshot({path:"artifacts/v4-ux/01-overview.png"});
      await page.locator("#mon-search").fill("Timing 1");
      assert.equal(await page.locator("#overview .mon-card").count(),1);
      await page.locator("#mon-search").fill("");
      assert.equal(await page.locator("#overview .mon-card").count(),10);
      await page.locator("[data-mon-filter=attention]").click();
      await page.locator("[data-mon-filter=all]").click();
      await page.locator("#overview [data-mon-detail]").first().click();
      assert.equal(await page.locator("#overview .mon-agent-list").count(),1);
      await page.locator("#overview [data-mon-detail]").first().click();
      await page.locator('[data-mode="workspace"]').click();
      await first.click(filter);
      assert.equal(await page.locator(".node.big.active-card .cin").inputValue(),"unsent fixture");
      await page.screenshot({path:"artifacts/v4-ux/02-workspace.png"});
      await page.locator(".node.big.active-card [data-bslot=chat]").selectOption("side");
      await page.waitForSelector('.node.big.active-card .blk[data-bkey=chat][data-slot=side]',filter);
      assert.equal(await page.locator(".node.big.active-card .cin").inputValue(),"unsent fixture");
      await page.locator(".node.big.active-card [data-bslot=chat]").selectOption("main");
      await page.locator('[data-mode="map"]').click();
      await sessionName("Timing 1").click(filter);
      await page.screenshot({path:"artifacts/v4-ux/03-live-map.png"});
      const before = await page.evaluate(()=>JSON.stringify([...BIGPOS]));
      await page.locator("#layout-preset").selectOption("vertical");
      await page.locator("#layout-apply").click();
      await page.locator("#layout-undo").click();
      assert.equal(await page.evaluate(()=>JSON.stringify([...BIGPOS])),before);
      await page.locator("#layout-redo").click();
      await page.locator("#layout-save").click();
      assert.ok(await page.evaluate(()=>localStorage.getItem("omp-map-layout-preset-v4")));
      const row=first.locator("..").locator("..");
      await row.locator("[data-slmenu]").click();
      await page.waitForSelector("#ctxmenu.open",filter);
      await page.keyboard.press("Escape");
      const stops=[];
      page.on("request",r=>{if(r.url().endsWith("/api/session/stop"))stops.push(r.url());});
      await row.locator("[data-slclose]").click();
      assert.equal(stops.length,0);
      assert.equal(await first.count(),1);
      const times = [];
      const sampleEpoch = Date.now();
      for (let i = 1; i <= 20; i++) {
        const title = `SSE sample ${String(i).padStart(2, "0")}`;
        const timestamp = new Date(sampleEpoch + i * 100).toISOString();
        const record = { type: "title", title, timestamp };
        await fs.appendFile(fileOf(9), JSON.stringify(record) + "\n");
        const start = performance.now();
        scan();
        broadcast();
        await sessionName(title).waitFor(filter);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1];
      console.log(`10 fixture sessions, 20 samples, scan → SSE → DOM p95: ${p95.toFixed(1)} ms`);
      assert.ok(p95 < 1000, `p95 exceeded 1 second: ${p95.toFixed(1)} ms`);
      assert.deepEqual(errors, []);
    } catch (error) {
      const panel = await page.locator("#slList").textContent({ timeout: 2000 }).catch(() => "");
      throw new Error(`${error.message}\nSession panel: ${panel}\nConsole: ${errors.join(" | ")}`, { cause: error });
    } finally {
      await browser.close();
    }
  }));
