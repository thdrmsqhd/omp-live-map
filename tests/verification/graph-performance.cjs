"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setImmediate: yieldToNetwork } = require("node:timers/promises");
const { performance } = require("node:perf_hooks");
const { test } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(process.env.OMP_BENCH_REPO || path.join(__dirname, "../.."));
const { withLegacyHttp } = require(path.join(root, "tests/helpers/legacy-http"));
const samples = 30;
const warmup = 8;

function percentiles(times) {
  times.sort((a, b) => a - b);
  return Object.fromEntries([50, 95, 99].map((p) => [`p${p}`, Number(times[Math.ceil(times.length * p / 100) - 1].toFixed(2))]));
}

test("same-fixture scan → real SSE → DOM and concurrent chat load", { timeout: 120_000 }, (t) =>
  withLegacyHttp(t, async ({ config, directory }) => {
    const { scan } = require(path.join(root, "server/tail"));
    const { broadcast, pushChat } = require(path.join(root, "server/sse"));
    const fixture = path.join(config.SESSIONS, "benchmark");
    await fs.mkdir(fixture, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.OMP_BENCH_CHROMIUM });
    const results = [];
    try {
      for (const count of [1, 4, 8, 10, 16, 32]) {
        const files = Array.from({ length: count }, (_, i) => path.join(fixture, `graph-${i}.jsonl`));
        const epoch = Date.now();
        const line = (type, props, time) => JSON.stringify({ type, ...props, timestamp: new Date(time).toISOString() }) + "\n";
        await Promise.all(files.map((file, i) => fs.writeFile(file,
          line("session", { id: `graph-${i}`, cwd: directory }, epoch) + line("title", { title: `Fixture ${i}` }, epoch))));
        scan();
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await page.addInitScript(() => {
            const NativeSource = window.EventSource;
            window.graphSample = { bytes: 0, events: 0 };
            window.EventSource = class extends NativeSource {
              constructor(...args) {
                super(...args);
                this.addEventListener("message", ({ data }) => {
                  window.graphSample.bytes += new TextEncoder().encode(data).length;
                  window.graphSample.events++;
                });
              }
            };
          });
          const connected = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/events" && r.ok());
          await page.goto(`http://127.0.0.1:${config.PORT}`);
          await connected;
          await page.waitForFunction((n) => document.querySelectorAll("#slList .sl-row.main").length === n, count);
          await page.evaluate((ids) => {
            if (typeof setMapMode === "function") setMapMode("workspace");
            for (const id of ids) openNode(id);
          }, files.slice(0, 4));
          await page.waitForSelector(".node.big");
          broadcast();
          const times = [];
          let rssSampleMax = 0;
          let heapSampleMax = 0;
          let timingStart;
          let trafficStart;
          const scanTimes = [];
          const broadcastTimes = [];
          for (let i = 0; i < warmup + samples; i++) {
            if (i === warmup) {
              trafficStart = await page.evaluate(() => window.graphSample);
              timingStart = process.cpuUsage();
            }
            const title = `SSE sample ${i}`;
            await fs.appendFile(files[0], line("title", { title }, epoch + (i + 1) * 100));
            const start = performance.now();
            scan();
            const scanned = performance.now();
            broadcast();
            const broadcastAt = performance.now();
            await page.waitForFunction((name) => [...document.querySelectorAll("#slList .sl-row.main .nm")].some((el) => el.textContent === name), title);
            if (i >= warmup) {
              times.push(performance.now() - start);
              scanTimes.push(scanned - start);
              broadcastTimes.push(broadcastAt - scanned);
              const memory = process.memoryUsage();
              rssSampleMax = Math.max(rssSampleMax, memory.rss);
              heapSampleMax = Math.max(heapSampleMax, memory.heapUsed);
            }
          }
          const cpu = process.cpuUsage(timingStart);
          const trafficEnd = await page.evaluate(() => window.graphSample);
          await page.evaluate((ids) => {
            window.fixtureIds = ids;
          }, files);
          const text = "한글 SSE stream fixture ".repeat(20);
          const fragments = 32;
          const streamStart = performance.now();
          for (const node of files) pushChat({ node, kind: "req", text: "fixture" });
          for (let i = 0; i < fragments; i++) {
            for (const node of files) pushChat({ node, kind: "delta", text });
            await yieldToNetwork();
          }
          await page.waitForFunction((expected) => window.fixtureIds.every((id) => chatState(id).stream === expected), text.repeat(fragments));
          const streamMs = performance.now() - streamStart;
          for (const node of files) pushChat({ node, kind: "done" });
          await page.waitForFunction(() => window.fixtureIds.every((id) => !chatState(id).busy));
          assert.ok(trafficEnd.events - trafficStart.events >= samples);
          results.push({ count, samples, warmup, scanMs: percentiles(scanTimes), broadcastMs: percentiles(broadcastTimes),
            scanToDomMs: percentiles(times), ssePayloadBytes: trafficEnd.bytes - trafficStart.bytes, streamMs: Number(streamMs.toFixed(2)),
            maxSampledRssBytes: rssSampleMax, maxSampledHeapUsedBytes: heapSampleMax, cpuMicroseconds: cpu });
        } finally { await page.close(); }
      }
      const report = { ref: process.env.OMP_BENCH_REF || "workspace", node: process.version, chromium: browser.version(), platform: process.platform,
        memoryScope: "Node API server and Playwright driver in one process; excludes Chromium and external CLIs", results };
      if (process.env.OMP_BENCH_OUTPUT) await fs.writeFile(process.env.OMP_BENCH_OUTPUT, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } finally { await browser.close(); }
  }));
