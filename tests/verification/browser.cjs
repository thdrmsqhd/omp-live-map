"use strict";

// 브라우저 회귀 + 10개 세션 측정(CI "Browser regression and 10-session measurement").
// 지금 화면: 관제 벽(#umap: 프로젝트·폴더 타일 > 에이전트 카드) ↔ 세션 하나 전체 화면(#stage 의 큰 카드, '열기'·두 번 누르기, Esc 로 복귀).
// 예전 탭(관제·워크스페이스·맵)·세션 목록 패널·레이아웃 프리셋·관제 카드 검색/필터는 없어져, 그 검사는 벽·전체 화면 검사로 바꿨다.

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { withLegacyHttp } = require("../helpers/legacy-http");

const SESSIONS = 10;

test("monitoring wall shows 10 sessions, opens a session full view and renders live updates",
  { timeout: 90000 }, (t) => withLegacyHttp(t, async ({ directory, config }) => {
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
      // Monaco 는 jsDelivr CDN 에서 받는다: 같은 버전의 로컬 패키지로 대신 응답한다(네트워크 없이 결정적).
      const cdn = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/";
      const assets = path.join(path.dirname(require.resolve("monaco-editor/package.json")), "min");
      await page.route(cdn + "**", (route) => {
        const relative = new URL(route.request().url()).pathname.split("/min/")[1];
        if (!relative || !/^vs\/[A-Za-z0-9_./-]+$/.test(relative) || relative.split("/").includes("..")) return route.abort();
        return route.fulfill({ path: path.join(assets, relative), headers: { "access-control-allow-origin": "*" } });
      });

      // 세션 10개: 같은 폴더(cwd)라 폴더 타일 하나에 에이전트 카드 10장. 방금 쓴 기록이라 모두 '실행 중'.
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
      await Promise.all(Array.from({ length: SESSIONS }, (_, i) => seed(i)));
      scan();
      const filter = { timeout: 8000 };
      const connected = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/events" && response.ok());
      await page.goto(`http://127.0.0.1:${config.PORT}`);
      await connected;

      // 관제 벽: 타일 하나, 에이전트 카드 10장, 타일 머리 지표 '세션 10'.
      const agents = page.locator("#umap-items .um-agent[data-node]");
      const agentCard = (title) => agents.filter({ has: page.locator(".um-aname", { hasText: new RegExp(`^${title}$`) }) });
      const wallCount = () => page.waitForFunction((n) => document.querySelectorAll("#umap-items .um-agent[data-node]").length === n, SESSIONS, filter);
      const view = (mode) => page.waitForFunction((m) => document.getElementById("app").dataset.view === m, mode, filter);
      await page.waitForSelector("#umap-items .um-tile", filter);
      await wallCount();
      assert.equal(await page.locator("#app").getAttribute("data-view"), "map");
      assert.equal(await page.locator("#umap-items .um-tile").count(), 1);
      assert.match(await page.locator("#umap-items .um-tile .um-stats").first().textContent(), new RegExp(`세션 ${SESSIONS} `));
      for (let i = 0; i < SESSIONS; i++) assert.equal(await agentCard(`Timing ${i}`).count(), 1, `agent card Timing ${i}`);
      // 예전 탭 UI(관제 카드·모드 탭)는 없다.
      assert.equal(await page.locator("#overview, #viewModes, [data-mode]").count(), 0);
      // 맵 카드 글자는 100%에서 12px 이상.
      const wallFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll("#umap-items .um-agent[data-node] :is(.um-aname, .um-goal, .um-now)")]
        .map((el) => parseFloat(getComputedStyle(el).fontSize))));
      assert.ok(wallFont >= 12, `wall card text below 12px: ${wallFont}`);

      // 세션 전체 화면: '열기' 단추로 연다. 제목·지표 6칸·상세 지표(늘 보임, 접기 단추 없음), 편집기 블록은 처음에 없다.
      const active = page.locator("#nodes .node.big.active-card");
      const openSession = async (title) => {
        await agentCard(title).locator("[data-um=open]").click(filter);
        await page.waitForFunction((t) => document.getElementById("app").dataset.view === "workspace"
          && document.querySelector("#nodes .node.big.active-card")?.innerText.includes(t), title, filter);
      };
      await openSession("Timing 0");
      assert.equal(await page.locator("#back-to-map").isVisible(), true);
      assert.equal(await page.locator("#umap").isVisible(), false);
      assert.equal(await active.count(), 1);
      assert.equal(await active.locator("[data-blk=editor]").count(), 0);
      assert.equal(await active.locator(".card-summary>div").count(), 6);
      assert.equal(await active.locator("[data-metrics-toggle]").count(), 0);
      assert.equal(await active.locator(".card-metrics-detail").isVisible(), true);
      // 전체 화면 대화 글자도 읽을 수 있는 크기(12px 이상).
      const chatFont = await active.locator(".cmsgs").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(chatFont >= 12, `full view chat text below 12px: ${chatFont}`);
      // Esc = 맵으로.
      await page.keyboard.press("Escape");
      await view("map");
      assert.equal(await page.locator("#umap").isVisible(), true);
      assert.equal(await agents.count(), SESSIONS);
      // 두 번 누르기로도 연다.
      await agentCard("Timing 0").locator(".um-goal").dblclick(filter);
      await view("workspace");
      assert.match(await active.innerText(), /Timing 0/);

      // 코드 편집기(Monaco): 전체 화면의 '코드' → 탐색기에서 파일을 열어 고치고 Ctrl+S 로 저장한다.
      await active.locator("[data-card-editor]").click();
      await active.locator(".exr").filter({ hasText: editorFixture }).click(filter);
      await page.waitForFunction(() => document.querySelector("#nodes .node.big.active-card .view-lines")?.innerText.includes("original"), null, filter);
      await active.locator(".view-lines").click(filter);
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText("updated through Monaco");
      const saved = page.waitForResponse((response) => response.url().endsWith("/api/editor/write") && response.ok());
      await page.keyboard.press("Control+S");
      assert.equal((await (await saved).json()).ok, true);
      assert.equal(await fs.readFile(file, "utf8"), "updated through Monaco");

      // 새로고침해도 SSE 에 다시 붙고 같은 벽을 그린다(저장된 모드가 전체 화면이면 '맵으로').
      const reconnected = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/events" && response.ok());
      await page.reload();
      await reconnected;
      if (await page.locator("#app").getAttribute("data-view") !== "map") await page.locator("#back-to-map").click(filter);
      await view("map");
      await wallCount();

      // 초안·미리보기·대화 검색: 보내지 않은 지시는 저장되고 벽을 다녀와도 남는다.
      await openSession("Timing 0");
      await active.locator(".cin").fill("unsent fixture");
      assert.equal(await active.locator("[data-send]").isEnabled(), true);
      assert.equal(await page.evaluate(() => localStorage.getItem("omp-map-draft-v1:" + activeCardId)), JSON.stringify("unsent fixture"));
      await active.locator(".prompt-secondary summary").click();
      await active.locator("[data-prompt-action=preview]").click();
      assert.equal(await active.locator(".prompt-preview").isVisible(), true);
      await active.locator("[data-prompt-action=preview]").click();
      assert.equal(await active.locator(".chat-search").isVisible(), false);
      await active.locator("[data-chat-search-toggle]").click();
      await active.locator(".chat-search").fill("no matching fixture");
      await page.waitForFunction(() => document.querySelector("#nodes .node.big.active-card .cmsgs")?.textContent.trim() === "검색 결과 없음", null, filter);
      await active.locator("[data-chat-search-clear]").click();

      // 대화 스트림 부하(동시 1·4·8·16개, 각 100 델타): 두 프레임 안에 끝까지 쌓인다.
      for (const count of [1, 4, 8, 16]) {
        const load = await page.evaluate(async (count) => {
          const ids = Array.from({ length: count }, (_, i) => "perf-fixture-" + i);
          const t = performance.now();
          for (const id of ids) {
            handleChatEvent({ node: id, kind: "req", text: "load fixture", turnId: "load-" + id });
            for (let i = 0; i < 100; i++) handleChatEvent({ node: id, kind: "delta", text: "한글 streaming data ".repeat(40) });
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const lengths = ids.map((id) => chatState(id).stream.length);
          for (const id of ids) { handleChatEvent({ node: id, kind: "done", turnId: "load-" + id }); CHAT.delete(id); }
          return { ms: performance.now() - t, lengths };
        }, count);
        assert.equal(load.lengths.length, count);
        assert.ok(load.lengths.every((n) => n > 50000));
        console.log(count + " concurrent fixture streams:", load.ms.toFixed(1), "ms");
      }
      const perf = await page.evaluate(() => fetch("/api/performance").then((r) => r.json()));
      assert.ok(perf.current.memory.rss > 0);
      console.log("Backend RSS bytes:", perf.current.memory.rss, "heap:", perf.current.memory.heapUsed);

      // 블록 자리 바꾸기(중앙 → 오른쪽 → 중앙)와 벽 왕복에도 초안이 남는다.
      await active.locator("[data-bslot=chat]").selectOption("side");
      await page.waitForSelector("#nodes .node.big.active-card .blk[data-bkey=chat][data-slot=side]", filter);
      assert.equal(await active.locator(".cin").inputValue(), "unsent fixture");
      await active.locator("[data-bslot=chat]").selectOption("main");
      await page.waitForSelector("#nodes .node.big.active-card .blk[data-bkey=chat][data-slot=main]", filter);
      await page.locator("#back-to-map").click();
      await view("map");
      await openSession("Timing 0");
      assert.equal(await active.locator(".cin").inputValue(), "unsent fixture");

      // 접근성 자동 검사(axe-core): 색 대비·버튼·입력 이름. 세션 전체 화면과 관제 벽.
      const axeSource = await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8");
      await page.evaluate(axeSource);
      const axeCheck = async (where) => {
        await page.waitForTimeout(300);
        const result = await page.evaluate(() => axe.run(document, { runOnly: ["color-contrast", "button-name", "label", "select-name"] }));
        assert.deepEqual(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), [], `axe violations in ${where}`);
      };
      await axeCheck("session full view");

      // 카드 닫기(✕)는 세션을 끝내지 않는다: 종료 요청 없음, 벽에 카드가 그대로.
      const stops = [];
      page.on("request", (r) => { if (r.url().endsWith("/api/session/stop")) stops.push(r.url()); });
      await active.locator("[data-close]").click();
      await page.waitForFunction(() => !document.querySelector("#nodes .node.big.active-card"), null, filter);
      await page.locator("#back-to-map").click(filter);
      await view("map");
      assert.equal(stops.length, 0);
      assert.equal(await agentCard("Timing 0").count(), 1);
      await axeCheck("monitoring wall");

      // 에이전트 카드 우클릭 메뉴(열기·활동 서랍·자동 배치로 되돌리기)는 Esc 로 닫힌다.
      await agentCard("Timing 1").locator(".um-goal").click({ button: "right" });
      await page.waitForSelector(".inline-menu[role=menu]", filter);
      assert.match(await page.locator(".inline-menu").innerText(), /열기/);
      await page.waitForTimeout(100); // 메뉴는 다음 틱에 Esc·바깥 누르기 처리기를 붙인다(view/inline-edit.js inlineMenu).
      await page.keyboard.press("Escape");
      await page.waitForSelector(".inline-menu", { state: "detached", ...filter });

      // 폭 1024·1440·1920: 위쪽 막대는 한 줄이고 넘치지 않으며, 타일은 막대 아래에 서로 겹치지 않고, 미니맵이 보이면 막대를 가리지 않는다.
      const layout = () => page.evaluate(() => {
        const topbar = document.getElementById("topbar"), bar = topbar.getBoundingClientRect();
        const tiles = [...document.querySelectorAll("#umap-items .um-tile")].map((el) => el.getBoundingClientRect());
        const minimap = document.getElementById("minimap"), mm = minimap.getBoundingClientRect();
        const apart = (a, b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
        return {
          barH: bar.height,
          overflow: topbar.scrollWidth - topbar.clientWidth,
          tilesBelow: tiles.every((r) => r.top >= bar.bottom - 1),
          tilesApart: tiles.every((a, i) => tiles.every((b, j) => i === j || apart(a, b))),
          minimapClear: !minimap.checkVisibility() || apart(mm, bar),
        };
      });
      for (const width of [1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(250);
        const at = await layout();
        assert.ok(at.barH <= 48, `top bar wraps at ${width}px: ${JSON.stringify(at)}`);
        assert.ok(at.overflow <= 1, `top bar overflows at ${width}px: ${JSON.stringify(at)}`);
        assert.equal(at.tilesBelow, true, `tile under the top bar at ${width}px`);
        assert.equal(at.tilesApart, true, `tiles overlap at ${width}px`);
        assert.equal(at.minimapClear, true, `minimap overlaps the top bar at ${width}px`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      // scan → SSE → 벽 DOM 갱신 시간(세션 10개, 표본 20개): 마지막 세션의 제목을 바꾸면 그 에이전트 카드 제목이 바뀐다.
      const times = [];
      const sampleEpoch = Date.now();
      for (let i = 1; i <= 20; i++) {
        // 벽은 연달아 오는 갱신을 400ms 단위로 모아 그린다(view/umap-render.js paintUmapSoon): 표본 사이를 그보다 길게 띄워 갱신 하나의 지연을 잰다.
        await page.waitForTimeout(500);
        const title = `SSE sample ${String(i).padStart(2, "0")}`;
        const timestamp = new Date(sampleEpoch + i * 100).toISOString();
        const record = { type: "title", title, timestamp };
        await fs.appendFile(fileOf(SESSIONS - 1), JSON.stringify(record) + "\n");
        const start = performance.now();
        scan();
        broadcast();
        await agentCard(title).waitFor(filter);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1];
      console.log(`${SESSIONS} fixture sessions, 20 samples, scan → SSE → DOM p50: ${times[Math.floor(times.length / 2)].toFixed(1)} ms, p95: ${p95.toFixed(1)} ms`);
      assert.ok(p95 < 1000, `p95 exceeded 1 second: ${p95.toFixed(1)} ms`);
      assert.equal(await agents.count(), SESSIONS);
      assert.deepEqual(errors, []);
    } catch (error) {
      const wall = await page.locator("#umap-items").innerText({ timeout: 2000 }).catch(() => "");
      throw new Error(`${error.message}\nWall: ${wall.slice(0, 1500)}\nConsole: ${errors.join(" | ")}`, { cause: error });
    } finally {
      await browser.close();
    }
  }));
