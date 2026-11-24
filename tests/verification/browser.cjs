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
      await first.click(filter);
      await page.waitForSelector("#slList .sl-row.open", filter);
      await page.waitForFunction(() => document.querySelector("#nodes").innerText.includes("Timing 0"), null, filter);
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
      const connected = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.ok());
      await page.reload();
      await connected;
      await page.waitForSelector("#sessions.collapsed", filter);
      await page.locator("#slToggle").click();
      await page.waitForFunction(() => document.querySelectorAll("#slList .sl-row.main").length === 10, null, filter);

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
