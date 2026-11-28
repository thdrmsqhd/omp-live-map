"use strict";

// 프로젝트 타일 안의 순수 계산: Task 줄 순서(개입 필요 → 진행 중 → 대기 → 완료), 타일 폭에 맞춘 자동 배치(넓으면 옆으로·줄 넘김, 좁으면 단계 쌓기),
// 옮긴 카드 자리 저장·되돌리기와 저장 키 이전(viewmodel/task-map.js), Workflow 편집의 단계 목록 연산. 타일 격자는 tests/umap-wall.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const UI = path.join(__dirname, "../ui/js");
// vm 안에서 만든 배열·객체는 다른 realm 이라 deepEqual 전에 평범한 값으로 바꾼다.
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(files, globals = {}) {
  const store = new Map();
  const context = vm.createContext({
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) },
    viewUpdates: {}, DATA: { sessions: [] }, ALIAS: new Map(), ...globals,
  });
  // core/persist.js 전체를 싣지 않고 쓰는 도우미만 넣는다(같은 구현).
  vm.runInContext(`const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } };
    const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const strList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string") : []);`, context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(UI, file), "utf8"), context, { filename: file });
  return { context, store, run: (code) => vm.runInContext(code, context) };
}

test("task rows are ordered: needs attention → running → waiting(backlog) → completed, newest first inside a group", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const tasks = [
    { id: "done", status: "completed", updated: 50 }, { id: "back-old", status: "backlog", updated: 1 },
    { id: "run", status: "running", updated: 10 }, { id: "wait", status: "waiting_approval", updated: 5 },
    { id: "back-new", status: "backlog", updated: 9 }, { id: "ready", status: "ready", updated: 3 }, { id: "held", status: "blocked", updated: 7 },
    { id: "custom", status: "qa-1", updated: 8 },
  ];
  const ids = plain(run("umapOrderTasks").call(null, tasks).map(({ id }) => id));
  assert.deepEqual(ids, ["held", "wait", "run", "back-new", "custom", "ready", "back-old", "done"]);
});

test("tile layout (wide, project full-screen): task card left, stages to the right, the row wraps when the width is full, agent trees under their stage", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const U = run("UMAP"), A = run("UMAP_AGENT");
  const band = { key: "project:a", tasks: [
    { id: "t1", stages: [{ id: "plan", sessions: [{ id: "s1", node: {}, children: [] }, { id: "s2", node: {} }] }, { id: "work", sessions: [] }, { id: "ok", sessions: [] }, { id: "ship", sessions: [] }] },
    { id: "t2", status: "completed", collapsed: true, stages: [{ id: "plan", sessions: [{ id: "s3", node: {}, compact: true }] }] },
  ], free: [{ folder: "C:/w/a", sessions: [{ id: "f1", node: {} }] }] };
  const layout = run("umapTileLayout").call(null, band, { width: 1440 });
  const box = (key) => layout.boxes[key];
  assert.equal(layout.wide, true);
  assert.equal(box("task:t1").x, U.PAD);
  assert.equal(box("stage:t1:plan").x, U.STAGE_X);
  assert.equal(box("stage:t1:work").x, box("stage:t1:plan").x + box("stage:t1:plan").w + U.STAGE_GAP, "the next stage starts after the previous column");
  assert.equal(box("stage:t1:plan").y, box("task:t1").y, "stages share the task row");
  assert.equal(box("stage:t1:ok").x, U.STAGE_X, "a stage that does not fit the width wraps to the next line");
  const rowBottom = Math.max(...["sess:s1", "sess:s2", "stage:t1:work"].map((key) => box(key).y + box(key).h));
  assert.equal(box("stage:t1:ok").y, rowBottom + U.ROW_GAP, "the wrapped line starts below the tallest column of the line above");
  assert.equal(box("stage:t1:ship").y, box("stage:t1:ok").y, "and keeps flowing to the right");
  assert.equal(box("sess:s1").x, box("stage:t1:plan").x, "an agent sits right under its stage");
  assert.equal(box("sess:s1").y, box("stage:t1:plan").y + U.STAGE_H + U.SESS_TOP);
  const H = run("umapAgentHeight")(null);
  assert.equal(box("sess:s2").y, box("sess:s1").y + H + A.GAP);
  assert.equal(box("sess:s2").w, A.W, "a wide tile keeps the full card width");
  assert.equal(box("task:t2").h, U.TASK_H, "a completed task is laid out fully (dimmed by the view, not collapsed)");
  assert.ok(box("stage:t2:plan") && box("sess:s3"), "a completed task still shows its stages and agents");
  assert.ok(box("sess:f1").y > box("sess:s3").y, "sessions without a task follow the task rows inside the tile");
  assert.deepEqual(plain(layout.links.filter(({ from }) => from === "stage:t1:plan").map(({ to }) => to)).sort(), ["sess:s1", "sess:s2", "stage:t1:work"]);
  const cards = Object.values(layout.boxes).filter(({ kind }) => kind !== "folder");
  for (const [i, p] of cards.entries()) for (const q of cards.slice(i + 1)) assert.equal(run("umapOverlap")(p, q), false, p.key + " overlaps " + q.key);
  for (const b of Object.values(layout.boxes)) assert.ok(b.x + b.w <= 1440, b.key + " stays inside the full-screen width");
});

test("tile layout (narrow wall tile): stages stack under the task card at the tile width, cards narrow but keep their sentence height, nothing overlaps or leaves the tile", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const U = run("UMAP"), A = run("UMAP_AGENT");
  const lines = (recent) => ({ recent: Array.from({ length: recent }, (_, i) => ({ text: "r" + i })), counters: "읽음 1" });
  const leaf = (id, recent = 0) => ({ id, node: {}, lines: lines(recent), children: [] });
  const main = { id: "m", node: {}, lines: lines(3), children: [{ id: "a", node: {}, lines: lines(3), children: [leaf("a1", 1)] }, leaf("b", 2)] };
  const band = { key: "project:shop", adding: true, tasks: [{ id: "t", stages: [{ id: "plan", sessions: [leaf("p0", 3)] }, { id: "work", sessions: [main] }, { id: "ok", sessions: [] }] }],
    free: [{ folder: "C:/w", sessions: [leaf("i", 3), leaf("j", 1), leaf("k")] }] };
  for (const width of [448, 384, 300]) {
    const layout = run("umapTileLayout").call(null, band, { width });
    const box = (key) => layout.boxes[key];
    assert.equal(layout.wide, false, width + ": a wall tile uses the stacked layout");
    const stages = ["plan", "work", "ok"].map((id) => box("stage:t:" + id));
    assert.ok(stages.every((b) => b.x === U.PAD_NARROW && b.w === width - 2 * U.PAD_NARROW), width + ": stages span the tile width, one per line");
    assert.ok(stages[0].y >= box("task:t").y + U.TASK_H, width + ": the first stage starts under the task card");
    assert.ok(stages[1].y > box("sess:p0").y + box("sess:p0").h && stages[2].y > box("sess:b").y + box("sess:b").h, width + ": the next stage comes after the previous stage's whole agent tree");
    assert.equal(box("sess:a1").x, box("sess:m").x + 2 * A.INDENT, width + ": nested subagents still indent");
    assert.ok(box("sess:a1").w >= A.MIN_W, width + ": a nested card never gets narrower than the readable minimum");
    assert.equal(box("sess:m").h, A.PAD + A.HEAD + (2 + 3 + 1) * A.ROW, width + ": card height follows its sentences (text is not shrunk)");
    assert.ok(box("add:project:shop").w <= width, width + ": the ＋ Task line fits the tile");
    const cards = Object.values(layout.boxes).filter(({ kind }) => kind !== "folder");
    for (const [i, p] of cards.entries()) for (const q of cards.slice(i + 1)) assert.equal(run("umapOverlap")(p, q), false, width + ": " + p.key + " overlaps " + q.key);
    // 벽 타일 폭(424px 이상)에서는 두 단계 들여쓴 서브에이전트까지 타일 안에 든다 → 옆으로 스크롤할 일이 없다.
    if (width >= A.MIN_W + 2 * A.INDENT + 2 * U.PAD_NARROW) {
      assert.equal(layout.width, width, width + ": nothing widens the tile canvas (no sideways scrolling)");
      for (const b of Object.values(layout.boxes)) assert.ok(b.x >= 0 && b.x + b.w <= width, width + ": " + b.key + " stays inside the tile");
    }
    // 단계 → 다음 단계 선은 아래로 이어진다(왼쪽 틈으로 돌아 들어간다).
    assert.ok(layout.links.some(({ from, to, kind }) => from === "stage:t:plan" && to === "stage:t:work" && kind === "flow"));
  }
});

test("subagent cards: nested children indent under their parent, widen the stage column, size to their sentences and never overlap", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const U = run("UMAP"), A = run("UMAP_AGENT");
  const lines = (recent) => ({ recent: Array.from({ length: recent }, (_, i) => ({ text: "r" + i })), counters: "읽음 1" });
  const leaf = (id, recent = 0) => ({ id, node: {}, lines: lines(recent), children: [] });
  const main = { id: "m", node: {}, lines: lines(3), children: [{ id: "a", node: {}, lines: lines(3), children: [leaf("a1", 1)] }, leaf("b", 2)] };
  const band = { key: "project:a", tasks: [{ id: "t", stages: [{ id: "plan", sessions: [leaf("p0")] }, { id: "work", sessions: [main, leaf("m2")] }, { id: "ok", sessions: [] }] }],
    free: [{ folder: "C:/w", sessions: [{ id: "i", node: {}, lines: lines(3), children: [leaf("i1")] }, leaf("j"), leaf("k"), leaf("l"), leaf("m9"), leaf("n")] }] };
  const layout = run("umapTileLayout").call(null, band, { width: 2200 });
  const box = (key) => layout.boxes[key];
  assert.equal(box("sess:a").x, box("sess:m").x + A.INDENT, "a child is indented one step");
  assert.equal(box("sess:a1").x, box("sess:m").x + 2 * A.INDENT, "a nested child two steps");
  assert.ok(box("sess:a").y >= box("sess:m").y + box("sess:m").h && box("sess:a1").y >= box("sess:a").y + box("sess:a").h, "children go below the parent");
  assert.ok(box("sess:b").y >= box("sess:a1").y + box("sess:a1").h, "a sibling goes below the previous sibling's whole branch");
  assert.ok(box("sess:m2").y >= box("sess:b").y + box("sess:b").h, "the next agent goes below the whole tree");
  assert.equal(box("stage:t:work").w, 2 * A.INDENT + A.W, "the stage column widens to fit the tree");
  assert.equal(box("stage:t:ok").x, box("stage:t:work").x + box("stage:t:work").w + U.STAGE_GAP, "the next stage starts after the widened column");
  const cards = Object.values(layout.boxes).filter(({ kind }) => kind !== "folder");
  for (const [i, p] of cards.entries()) for (const q of cards.slice(i + 1)) assert.equal(run("umapOverlap")(p, q), false, p.key + " overlaps " + q.key);
  assert.deepEqual(plain(layout.links.filter(({ kind }) => kind === "sub").map(({ from, to }) => from + ">" + to)).sort(),
    ["sess:a>sess:a1", "sess:i>sess:i1", "sess:m>sess:a", "sess:m>sess:b"]);
  // 카드 높이는 문장 줄 수로 정해진다(배율과 무관): 머리 + 목표 + 지금/결과 + 최근 한 일 n + 카운터.
  assert.equal(box("sess:m").h, A.PAD + A.HEAD + (2 + 3 + 1) * A.ROW);
  assert.equal(box("sess:p0").h, A.PAD + A.HEAD + (2 + 0 + 1) * A.ROW, "a card with no actions yet is shorter, not empty space");
  assert.equal(run("umapAgentHeight")({ recent: [], counters: "" }), A.PAD + A.HEAD + 2 * A.ROW);
  assert.ok(A.W >= 320 && A.MIN_W >= 240, "agent cards are wide enough for one readable sentence per line");
  assert.equal(String(run("umapTileLayout")).includes("level"), false, "the layout does not depend on the zoom level");
});

test("a moved card keeps its manual spot inside its own tile canvas (pulled back inside a narrower tile) while the rest stays auto-laid-out, and reset returns it", () => {
  const { run, store } = load(["model/agent-lines.js", "model/task-map.js", "viewmodel/task-map.js"]);
  const a = { key: "project:a", tasks: [{ id: "t1", stages: [{ id: "plan", sessions: [{ id: "s1" }] }] }], free: [] };
  const b = { key: "project:b", tasks: [{ id: "t2", stages: [] }], free: [] };
  const auto = run("umapTileLayout").call(null, a, { width: 1440 });
  run("umapSetManual")("sess:s1", "project:a", 900.4, 40);
  const saved = JSON.parse(store.get("omp-umap-manual-v2"));
  assert.deepEqual(saved["sess:s1"], { band: "project:a", dx: 900, dy: 40 });
  const manual = run("UM").manual;
  const moved = run("umapTileLayout").call(null, a, { manual, width: 1440 });
  assert.deepEqual([moved.boxes["sess:s1"].x, moved.boxes["sess:s1"].y, moved.boxes["sess:s1"].manual], [900, 40, true]);
  assert.deepEqual([moved.boxes["task:t1"].x, moved.boxes["stage:t1:plan"].x], [auto.boxes["task:t1"].x, auto.boxes["stage:t1:plan"].x], "others stay auto");
  const narrow = run("umapTileLayout").call(null, a, { manual, width: 448 });
  assert.equal(narrow.boxes["sess:s1"].x, 448 - narrow.boxes["sess:s1"].w, "in a narrower tile the moved card is pulled back inside the canvas");
  assert.equal(narrow.width, 448);
  const other = run("umapTileLayout").call(null, b, { manual, width: 448 });
  assert.equal(other.boxes["sess:s1"], undefined, "a spot only applies to its own tile");
  assert.equal(run("umapIsManual")("sess:s1"), true);
  assert.equal(run("umapResetManual")("sess:s1"), true);
  assert.equal(JSON.parse(store.get("omp-umap-manual-v2"))["sess:s1"], undefined);
  const reset = run("umapTileLayout").call(null, a, { manual: run("UM").manual, width: 1440 });
  assert.deepEqual([reset.boxes["sess:s1"].x, reset.boxes["sess:s1"].y], [auto.boxes["sess:s1"].x, auto.boxes["sess:s1"].y]);
  // 전체 되돌리기와 타일 단위 되돌리기.
  run("umapSetManual")("task:t1", "project:a", 10, 10);
  run("umapSetManual")("task:t2", "project:b", 10, 10);
  run("umapResetAllManual")("project:a");
  assert.deepEqual(plain(Object.keys(run("UM").manual)), ["task:t2"]);
  run("umapResetAllManual")();
  assert.deepEqual(plain(Object.keys(run("UM").manual)), []);
});

test("persistence: tile order/sizes and card spots are read back on load; old band-order, band-relative card and old map-view keys are dropped", () => {
  const first = load(["model/agent-lines.js", "model/task-map.js", "viewmodel/task-map.js"]);
  first.run("umapWallSetOrder")(["project:b", "project:a", "folder:x"]);
  first.run("umapWallSetSize")("project:b", { w: 2.2, h: 5.6 });
  first.run("umapSetManual")("task:t1", "project:a", 5, 6);
  assert.deepEqual(JSON.parse(first.store.get("omp-umap-wall-v1")), { v: 1, order: ["project:b", "project:a", "folder:x"], sizes: { "project:b": { w: 2, h: 6 } } });
  for (const name of ["umapToggleBand", "umapToggleExpanded", "umapMoveBand", "umapOrderBands", "umapLayout"]) assert.equal(first.run("typeof " + name), "undefined", name + " is gone");
  const second = load(["model/agent-lines.js", "model/task-map.js"], {});
  for (const [key, value] of first.store) second.context.localStorage.setItem(key, value);
  // 예전 버전이 저장한 값: 띠 순서·접힘, 띠 기준 카드 자리, 한 맵 배율.
  second.context.localStorage.setItem("omp-umap-bands-v1", JSON.stringify({ order: ["folder:x"], collapsed: ["folder:x"] }));
  second.context.localStorage.setItem("omp-umap-manual-v1", JSON.stringify({ "task:old": { band: "project:a", dx: 1200, dy: 900 } }));
  second.context.localStorage.setItem("omp-umap-view-v1", JSON.stringify({ x: -400, y: -900, k: 0.4 }));
  vm.runInContext(fs.readFileSync(path.join(UI, "viewmodel/task-map.js"), "utf8"), second.context);
  const UM = second.run("UM");
  assert.deepEqual(plain(UM.wall), { order: ["project:b", "project:a", "folder:x"], sizes: { "project:b": { w: 2, h: 6 } } });
  assert.deepEqual(plain(UM.manual), { "task:t1": { band: "project:a", dx: 5, dy: 6 } }, "band-relative spots from the old map are not applied inside tiles");
  assert.deepEqual(plain(UM.view), { x: 0, y: 0, k: 1 }, "the wall opens at the top at 100% (the old zoomed map view is not restored)");
  for (const key of ["omp-umap-bands-v1", "omp-umap-manual-v1", "omp-umap-view-v1"]) assert.equal(second.context.localStorage.getItem(key), null, key + " is migrated away");
  assert.equal(UM.collapsed, undefined, "collapse state is gone");
  assert.equal(UM.order, undefined, "the old band order is not used");
  // 모양이 틀리거나 버전이 다른 벽 값은 버린다.
  const read = second.run("umapReadWall");
  assert.deepEqual(plain(read({ v: 2, order: ["x"] })), { order: [], sizes: {} });
  assert.deepEqual(plain(read({ v: 1, order: ["a", 3], sizes: { a: { w: 0, h: 2 }, b: { w: 1, h: 3 }, c: "big" } })), { order: ["a"], sizes: { b: { w: 1, h: 3 } } });
  second.run("umapWallResetSize")("project:b");
  assert.deepEqual(plain(UM.wall.sizes), {});
  second.run("umapWallReset")();
  assert.deepEqual(JSON.parse(second.context.localStorage.getItem("omp-umap-wall-v1")), { v: 1, order: [], sizes: {} });
});

test("fit: content fits the viewport, small content is centred, the wall fit never enlarges past 100%", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const fit = (content, view, opts) => plain(run("umapFitView")(content, view, opts));
  const small = fit({ width: 600, height: 300 }, { width: 1440, height: 800 });
  assert.equal(small.k, 1.25, "small content is enlarged up to 125% by default");
  assert.equal(small.x, Math.round((1440 - 600 * 1.25) / 2), "and centred horizontally");
  const wide = fit({ width: 4000, height: 900 }, { width: 1440, height: 800 });
  assert.ok(Math.abs(wide.k - (1440 - 48) / 4000) < 0.001, "big content is shrunk until it fits");
  assert.ok(4000 * wide.k <= 1440 && 900 * wide.k <= 800, "everything is inside the viewport");
  const wall = fit({ width: 1440, height: 700 }, { width: 1440, height: 800 }, { max: 1, pad: 0 });
  assert.deepEqual([wall.k, wall.x], [1, 0], "a wall that already fits stays at 100%");
  assert.ok(fit({ width: 1440, height: 1600 }, { width: 1440, height: 800 }, { max: 1, pad: 0 }).k === 0.5, "a taller wall is shrunk to show all of it");
  assert.deepEqual(fit({ width: 0, height: 0 }, { width: 1440, height: 800 }), { x: 24, y: 24, k: 1 }, "an empty map stays at 100%");
  assert.equal(typeof run("globalThis.umapInitialView"), "undefined", "there is no separate zoomed first view any more");
});

test("Workflow 편집 list operations insert, move and remove stage ids", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const ids = ["plan", "work", "ok"];
  assert.deepEqual(plain(run("umapInsertStage")(ids, 1, "review")), ["plan", "review", "work", "ok"]);
  assert.deepEqual(plain(run("umapMoveStage")(ids, "ok", 0)), ["ok", "plan", "work"]);
  assert.deepEqual(plain(run("umapRemoveStage")(ids, "work")), ["plan", "ok"]);
  const U = run("UMAP");
  assert.equal(run("umapDropIndex")(U.STAGE_X + 2 * (U.STAGE_W + U.STAGE_GAP) + 10, 3), 2);
  assert.equal(run("umapDropIndex")(-500, 3), 0);
  // 단계가 줄을 넘긴 배치: 가장 가까운 칸(왼쪽 위)으로.
  const spots = [{ x: 330, y: 20 }, { x: 766, y: 20 }, { x: 330, y: 400 }];
  assert.equal(run("umapDropIndex")(340, 3, spots, 390), 2, "dropping on the wrapped line picks the stage there");
  assert.equal(run("umapDropIndex")(700, 3, spots, 30), 1);
  // ＋ 자리: 맨 앞 · 사이 · 맨 뒤, 넘긴 줄의 단계 앞 ＋ 는 그 단계 왼쪽.
  const boxes = [{ x: 330, y: 20, w: 380 }, { x: 766, y: 20, w: 380 }, { x: 330, y: 400, w: 380 }];
  const plus = plain(run("umapEditSpots")(boxes, { x: 20, y: 20, w: 272 }));
  assert.equal(plus.length, 4);
  assert.deepEqual(plus.map(({ y }) => y), [20 + U.STAGE_H / 2 - 13, 20 + U.STAGE_H / 2 - 13, 400 + U.STAGE_H / 2 - 13, 400 + U.STAGE_H / 2 - 13]);
  assert.equal(plus[2].x, 330 - 32, "the ＋ before a wrapped stage sits at its left");
});

test("sessions are joined to stages by the runtime session id and unlinked ones stay in their project band", () => {
  const { run, context } = load(["model/monitor.js", "model/agent-lines.js", "model/task-map.js", "viewmodel/task-map.js"], { askPending: () => false });
  const node = (sid, cwd, status = "done") => ({ id: "file-" + sid, kind: "main", sid, cwd, status });
  context.DATA = { sessions: [
    { key: "k1", title: "plan session", nodes: [node("sid-1", "C:/w/shop"), { id: "file-sub-a", kind: "sub", parent: "file-sid-1", act: { recent: [{}, {}] } },
      { id: "file-sub-a1", kind: "sub", parent: "file-sub-a" }] },
    { key: "k2", title: "free session", nodes: [node("sid-2", "C:/w/shop/api", "live")] },
    { key: "k3", title: "other folder", nodes: [node("sid-3", "C:/w/notes")] },
  ] };
  const UM = run("UM");
  UM.projects = [{ id: "p", name: "shop", root: "C:/w/shop", archived: 0 }];
  UM.maps.set("p", { project: { id: "p" }, tasks: [{ id: "t", status: "completed", updated: 1, stages: [
    { id: "plan", status: "succeeded", sessions: [{ sessionId: "sid-1", attempt: 1, retry: 0 }, { sessionId: "gone", attempt: 2, retry: 0 }] }] }] });
  const bands = run("umapBands")(context.DATA.sessions);
  const shop = bands.find(({ key }) => key === "project:p");
  const stage = shop.tasks[0].stages[0];
  assert.equal(stage.sessions[0].node.id, "file-sid-1");
  assert.equal(stage.sessions[1].node, null, "a recorded session that is not on this PC stays a placeholder");
  assert.deepEqual(plain(stage.sessions[0].children.map(({ id }) => id)), ["file-sub-a"], "subagents hang under the agent that spawned them");
  assert.deepEqual(plain(stage.sessions[0].children[0].children.map(({ id }) => id)), ["file-sub-a1"], "nested subagents hang under their parent subagent");
  assert.equal(stage.sessions[0].lines.title, "plan session", "a stage agent card is titled with its real session title");
  assert.equal(stage.sessions[0].children[0].lines.sub, true, "a subagent card carries its sentence lines");
  assert.deepEqual(plain(shop.free.flatMap(({ sessions }) => sessions.map(({ id }) => id))), ["file-sid-2"], "linked sessions are not repeated as free sessions");
  assert.equal(shop.free[0].sessions[0].compact, undefined, "no compact chips");
  assert.equal(shop.tasks[0].collapsed, undefined, "a completed task is not collapsed");
  assert.ok(bands.some(({ key, project }) => key === "folder:c:/w/notes" && project === null), "sessions outside projects get their own folder band");
});
