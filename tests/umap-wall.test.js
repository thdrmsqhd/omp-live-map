"use strict";

// 관제 벽(프로젝트 타일 격자)의 순수 계산: 열 수·칸 높이, 타일 순서(개입 필요 → 진행 중 → 쉬는 중 · 저장한 순서),
// 내용대로 정하는 크기(쉬는 타일은 머리 한 줄 크기), 격자 채우기(겹침 없음), 모서리 크기 맞춤, 끌어 놓기 순서, 타일 상태 판정.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const UI = path.join(__dirname, "../ui/js");
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(files, globals = {}) {
  const store = new Map();
  const context = vm.createContext({
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) },
    viewUpdates: {}, DATA: { sessions: [] }, ALIAS: new Map(), askPending: () => false, ...globals,
  });
  vm.runInContext(`const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } };
    const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const strList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string") : []);`, context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(UI, file), "utf8"), context, { filename: file });
  return { context, store, run: (code) => vm.runInContext(code, context) };
}
const wall = () => load(["model/umap-wall.js"]);
const overlap = (a, b) => a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;

test("grid: 2–4 columns by viewport width (3 at 1440px, 4 at 1920px), tiles at least 440px wide, row unit fits 8 rows per screen", () => {
  const { run } = wall();
  const grid = (width, height = 820) => plain(run("umapWallGrid")({ width, height }));
  assert.equal(grid(1440).cols, 3);
  assert.equal(grid(1920).cols, 4);
  assert.equal(grid(1000).cols, 2, "never fewer than 2 columns");
  assert.equal(grid(700).cols, 2);
  assert.equal(grid(3840).cols, 4, "never more than 4 columns");
  for (const width of [1000, 1440, 1920]) {
    const g = grid(width);
    assert.ok(g.unitW >= 440, width + ": tiles stay wide enough for a readable agent card");
    assert.ok(g.pad * 2 + g.cols * g.unitW + (g.cols - 1) * g.gap <= width, width + ": the columns fill but never exceed the width");
  }
  const g = grid(1440, 820);
  assert.ok(g.pad * 2 + 8 * g.unitH + 7 * g.gap <= 820, "eight row units fit one screen");
  assert.equal(grid(1440, 300).unitH, 80, "the row unit never gets shorter than the header needs");
});

test("order: tiles needing attention first, then running, then idle (most recent first inside a group); a saved drag order wins and new tiles follow in state order", () => {
  const { run } = wall();
  const tiles = [
    { key: "idle-old", state: "idle", at: 1 }, { key: "run", state: "running", at: 5 }, { key: "attn-old", state: "attention", at: 2 },
    { key: "idle-new", state: "idle", at: 9 }, { key: "attn-new", state: "attention", at: 8 },
  ];
  assert.deepEqual(plain(run("umapWallOrder")(tiles, [])), ["attn-new", "attn-old", "run", "idle-new", "idle-old"]);
  assert.deepEqual(plain(run("umapWallOrder")(tiles, ["idle-old", "run", "gone"])), ["idle-old", "run", "attn-new", "attn-old", "idle-new"],
    "saved order first (unknown saved keys are ignored), then the rest by state");
});

test("size by content: running/attention tiles are big, idle tiles take one row (header + 최근 끝남), a resized tile keeps its saved size clamped to the grid", () => {
  const { run } = wall();
  const W = run("UMAP_WALL");
  const size = (tile, sizes = {}, cols = 3) => plain(run("umapTileSize")(tile, sizes, cols));
  assert.deepEqual(size({ key: "a", state: "attention" }), { w: 1, h: W.ACTIVE_H, auto: true });
  assert.deepEqual(size({ key: "r", state: "running" }), { w: 1, h: W.ACTIVE_H, auto: true });
  assert.deepEqual(size({ key: "i", state: "idle" }), { w: 1, h: W.IDLE_H, auto: true, small: true });
  assert.deepEqual(size({ key: "i", state: "idle", idleH: 2 }), { w: 1, h: 2, auto: true, small: true }, "an idle tile grows to show its recent finished items");
  assert.deepEqual(size({ key: "i", state: "idle", idleH: 9 }), { w: 1, h: W.IDLE_MAX, auto: true, small: true }, "but never past IDLE_MAX");
  assert.deepEqual(size({ key: "i", state: "idle", busy: true }), { w: 1, h: W.ACTIVE_H, auto: true }, "an idle tile with an open ＋ Task line grows while typing");
  assert.deepEqual(size({ key: "i", state: "idle" }, { i: { w: 2, h: 3 } }), { w: 2, h: 3, auto: false }, "a resized idle tile keeps the user's size");
  assert.deepEqual(size({ key: "r", state: "running" }, { r: { w: 9, h: 99 } }, 3), { w: 3, h: W.MAX_H, auto: false }, "a saved size never exceeds the grid");
  assert.equal(W.IDLE_H < W.ACTIVE_H, true);
});

test("an active tile is only as tall as its content (no half-empty tiles), still in whole grid cells; content taller than the active height keeps the active height", () => {
  const { run } = wall();
  const W = run("UMAP_WALL"), grid = plain(run("umapWallGrid")({ width: 1440, height: 820 }));
  const rows = run("umapWallRows");
  const one = rows(grid.unitH - W.HEAD_PX - 4, grid);
  assert.equal(one, 1, "a body that fits under the head in one cell needs one cell");
  assert.equal(rows(grid.unitH * 2, grid), Math.ceil((W.HEAD_PX + grid.unitH * 2 + grid.gap) / (grid.unitH + grid.gap)));
  const size = (tile, activeH) => plain(run("umapTileSize")(tile, {}, 3, activeH));
  assert.deepEqual(size({ key: "a", state: "running", need: 2 }, 6), { w: 1, h: 2, auto: true }, "a running tile with one card takes 2 cells, not 6");
  assert.deepEqual(size({ key: "a", state: "running", need: 1 }, 6), { w: 1, h: W.NEED_MIN, auto: true }, "but never less than the minimum for a working tile");
  assert.deepEqual(size({ key: "a", state: "attention", need: 12 }, 6), { w: 1, h: 6, auto: true }, "a long tile is capped at the active height (it scrolls inside)");
  assert.deepEqual(size({ key: "a", state: "running" }, 6), { w: 1, h: 6, auto: true }, "without a measured need the active height is used");
  assert.deepEqual(size({ key: "a", state: "idle", need: 5 }, 6), { w: 1, h: W.IDLE_H, auto: true, small: true }, "idle tiles ignore the body need");
  const idle = run("umapIdleRows");
  assert.equal(idle(0, grid), Math.max(1, Math.ceil((W.IDLE_HEAD_PX + W.RECENT_EMPTY_PX + grid.gap) / (grid.unitH + grid.gap))));
  for (const n of [1, 2, 3]) {
    const h = idle(n, grid), px = h * grid.unitH + (h - 1) * grid.gap;
    assert.ok(px >= W.IDLE_HEAD_PX + n * W.RECENT_PX, n + " recent items fit in " + h + " cells");
    assert.ok(h === 1 || (h - 1) * grid.unitH + (h - 2) * grid.gap < W.IDLE_HEAD_PX + n * W.RECENT_PX, "and the tile is not taller than needed");
  }
  const pack = plain(run("umapWallPack")([{ key: "a", state: "running", need: 2 }, { key: "b", state: "attention", need: 9 }], { cols: 3, fitRows: 6 }));
  assert.deepEqual(pack.tiles.map(({ key, h }) => key + ":" + h).sort(), ["a:2", "b:6"], "screen-fit growth still respects each tile's content");
});

test("packing: five projects fill a 3-column wall without overlap, attention tiles on the first row, idle tile small, resized tiles take their cells", () => {
  const { run } = wall();
  const W = run("UMAP_WALL");
  const tiles = [
    { key: "project:omp-live-map", state: "idle", at: 50 }, { key: "project:temp", state: "running", at: 40 },
    { key: "project:shop-api", state: "attention", at: 90 }, { key: "project:haccp", state: "running", at: 80 },
    { key: "project:works", state: "attention", at: 70 },
  ];
  const pack = plain(run("umapWallPack")(tiles, { cols: 3 }));
  const at = (key) => pack.tiles.find((tile) => tile.key === key);
  assert.deepEqual(pack.order, ["project:shop-api", "project:works", "project:haccp", "project:temp", "project:omp-live-map"]);
  assert.deepEqual([at("project:shop-api").row, at("project:shop-api").col, at("project:works").col, at("project:haccp").col], [0, 0, 1, 2], "attention, attention, running on the first row");
  assert.deepEqual([at("project:temp").row, at("project:temp").col], [W.ACTIVE_H, 0]);
  assert.deepEqual([at("project:omp-live-map").row, at("project:omp-live-map").col, at("project:omp-live-map").h], [W.ACTIVE_H, 1, W.IDLE_H], "the idle tile is one row tall next to the next active tile");
  assert.equal(pack.rows, 2 * W.ACTIVE_H, "all five fit two tile rows (one screen at 1440x900)");
  for (const [i, a] of pack.tiles.entries()) for (const b of pack.tiles.slice(i + 1)) assert.equal(overlap(a, b), false, a.key + " overlaps " + b.key);
  // 넓힌 타일과 저장한 순서.
  const resized = plain(run("umapWallPack")(tiles, { cols: 3, sizes: { "project:shop-api": { w: 2, h: 6 } }, order: ["project:haccp"] }));
  const r = (key) => resized.tiles.find((tile) => tile.key === key);
  assert.deepEqual([r("project:haccp").row, r("project:haccp").col], [0, 0], "the saved order puts haccp first");
  assert.deepEqual([r("project:shop-api").col, r("project:shop-api").w, r("project:shop-api").h], [1, 2, 6], "a two-column tile takes two cells");
  for (const [i, a] of resized.tiles.entries()) for (const b of resized.tiles.slice(i + 1)) assert.equal(overlap(a, b), false, a.key + " overlaps " + b.key);
  for (const tile of resized.tiles) assert.ok(tile.col + tile.w <= 3, tile.key + " stays inside the columns");
  // 한 화면 줄 칸 수(fitRows)를 주면 일하는 타일을 화면이 찰 만큼 키운다: 1920(4열)은 한 줄이라 7칸, 1440(3열)은 두 줄이라 4칸 그대로.
  const wide = plain(run("umapWallPack")(tiles, { cols: 4, fitRows: 8 }));
  assert.equal(wide.activeH, 7);
  assert.equal(wide.rows, 8, "the wall fills exactly one screen");
  assert.deepEqual(wide.tiles.filter(({ state }) => state !== "idle").map(({ h }) => h), [7, 7, 7, 7]);
  assert.deepEqual([wide.tiles.at(-1).key, wide.tiles.at(-1).row, wide.tiles.at(-1).h], ["project:omp-live-map", 7, W.IDLE_H], "the idle tile keeps its one-row size under them");
  assert.equal(plain(run("umapWallPack")(tiles, { cols: 3, fitRows: 8 })).activeH, W.ACTIVE_H, "two rows of active tiles already fill a 1440 screen");
  assert.equal(plain(run("umapWallPack")([...tiles, ...tiles.map((t) => ({ ...t, key: t.key + "2" }))], { cols: 3, fitRows: 8 })).activeH, W.ACTIVE_H, "more projects than one screen keep the normal size (the wall scrolls)");
  const kept = plain(run("umapWallPack")(tiles, { cols: 4, fitRows: 8, sizes: { "project:shop-api": { w: 1, h: 3 } } }));
  assert.equal(kept.tiles.find(({ key }) => key === "project:shop-api").h, 3, "a resized tile keeps its size when the others grow");
});

test("px rects, corner-resize snapping and drag reordering", () => {
  const { run } = wall();
  const grid = plain(run("umapWallGrid")({ width: 1440, height: 820 }));
  const rect = plain(run("umapWallRect")({ col: 1, row: 4, w: 2, h: 1 }, grid));
  assert.deepEqual(rect, { x: grid.pad + grid.unitW + grid.gap, y: grid.pad + 4 * (grid.unitH + grid.gap), w: 2 * grid.unitW + grid.gap, h: grid.unitH });
  const snap = (w, h) => plain(run("umapWallSnap")(w, h, grid));
  assert.deepEqual(snap(grid.unitW * 2 + 40, grid.unitH * 3), { w: 2, h: 3 }, "snaps to the nearest cell count");
  assert.deepEqual(snap(10, 10), { w: 1, h: 1 }, "never smaller than one cell");
  assert.deepEqual(snap(99999, 99999), { w: grid.cols, h: run("UMAP_WALL").MAX_H }, "never larger than the grid");
  const tiles = ["a", "b", "c", "d"].map((key, i) => ({ key, state: "running", at: 10 - i }));
  const pack = run("umapWallPack")(tiles, { cols: 3 });
  const centre = (key) => { const t = plain(pack.tiles.find((tile) => tile.key === key)); const r = run("umapWallRect")(t, grid); return [r.x + r.w / 2, r.y + 20]; };
  assert.deepEqual(plain(run("umapWallDrop")(pack, "a", ...centre("b"), grid)), ["b", "a", "c", "d"], "dropping on the next tile moves past it");
  assert.deepEqual(plain(run("umapWallDrop")(pack, "d", ...centre("a"), grid)), ["d", "a", "b", "c"], "dropping on an earlier tile goes before it");
  const empty = run("umapWallRect")({ col: 2, row: 4, w: 1, h: 1 }, grid);
  assert.deepEqual(plain(run("umapWallDrop")(pack, "a", empty.x + 10, empty.y + 10, grid)), ["b", "c", "d", "a"], "dropping on an empty cell at the end goes last");
  const size = plain(run("umapWallSize")(pack, grid));
  assert.equal(size.height, grid.pad * 2 + pack.rows * grid.unitH + (pack.rows - 1) * grid.gap);
});

test("tile state: approval waiting, failed run or an unanswered question → attention; running task or live agent → running; otherwise idle", () => {
  let asking = "";
  const { run, context } = load(["model/monitor.js", "model/agent-lines.js", "model/task-map.js", "model/umap-wall.js", "viewmodel/task-map.js"], { askPending: (id) => id === asking });
  const band = (key, tasks = [], free = [], sessions = []) => ({ key, tasks, free, sessions });
  const item = (id, status) => ({ id, node: { id, status }, lines: run("umapAgentLines")({ id, status }, {}), children: [] });
  const stage = (id, status, sessions = []) => ({ id, label: id, status, sessions });
  const bands = [
    band("project:shop", [{ id: "t1", title: "결제", status: "waiting_approval", run: { status: "waiting_approval", updated: 5 }, stages: [stage("plan", "succeeded"), stage("ok", "waiting_approval")] }]),
    band("project:works", [{ id: "t2", title: "진단", status: "blocked", run: { status: "failed", updated: 4 }, stages: [stage("scan", "failed")] }]),
    band("project:haccp", [{ id: "t3", title: "RAG", status: "running", run: { status: "running", updated: 9 }, stages: [stage("work", "running", [item("h1", "live")])] }]),
    band("project:temp", [], [{ folder: "C:/Temp", sessions: [item("x1", "live"), item("x2", "done")] }], [{ key: "k", lastTs: 7 }]),
    band("project:olm", [{ id: "t4", title: "문서", status: "completed", run: { status: "succeeded", updated: 3 }, stages: [stage("doc", "succeeded", [item("o1", "done")])] }]),
  ];
  const states = (list) => Object.fromEntries([...run("umapTileStates")(list)].map(([key, value]) => [key, value.state]));
  assert.deepEqual(states(bands), { "project:shop": "attention", "project:works": "attention", "project:haccp": "running", "project:temp": "running", "project:olm": "idle" });
  const meta = run("umapTileStates")(bands);
  assert.equal(meta.get("project:shop").attention[0].key, "stage:t1:ok", "the jump target is the stage waiting for approval");
  assert.equal(meta.get("project:works").attention[0].key, "stage:t2:scan", "a failed run jumps to its failed stage");
  assert.match(meta.get("project:works").attention[0].label, /실패/);
  assert.equal(meta.get("project:temp").at, 7, "recent activity comes from sessions too");
  asking = "o1";
  assert.equal(states(bands)["project:olm"], "attention", "an agent waiting for an answer needs attention");
  assert.equal(typeof context.umapTileStates, "function");
});

test("CPU·RAM: a node whose process was not found (res.proc 0) is unmeasured, not 0 — a session with no sample reports null so the tile shows '–'", () => {
  const { run } = load(["model/monitor.js"]);
  const stats = run("monitorSessionStats");
  const none = stats({ nodes: [{ id: "a", kind: "main", res: { cpu: 0, mb: 0, proc: 0 } }, { id: "b", kind: "sub", res: { cpu: 0, mb: 0, proc: 0 } }] }, 2048);
  assert.equal(none.cpu, null);
  assert.equal(none.ram, null);
  assert.equal(none.resourceWarning, false);
  const some = stats({ nodes: [{ id: "a", kind: "main", res: { cpu: 12.5, mb: 300, proc: 2 } }, { id: "b", kind: "sub", res: { cpu: 0, mb: 0, proc: 0 } }] }, 2048);
  assert.deepEqual([some.cpu, some.ram], [12.5, 300], "only measured nodes are summed");
  assert.equal(run("monitorResMeasured")({ cpu: 0, mb: 0, proc: 1 }), true, "a real idle process at 0% is a measurement");
  assert.equal(run("monitorResMeasured")(undefined), false);
  const render = fs.readFileSync(path.join(UI, "view/umap-render.js"), "utf8");
  assert.ok(!/acc\.cpu \+= st\.cpu \|\| 0/.test(render) && render.includes("CPU –") === false && render.includes('unmeasured("CPU")'), "the tile head shows '–' for an unmeasured total");
});

