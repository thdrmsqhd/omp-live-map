"use strict";

// 한 맵의 화면 쪽 순수 계산: Task 줄 순서(개입 필요 → 진행 중 → 대기 → 완료), 자동 배치(띠 > Task > 단계 > 세션),
// 옮긴 카드 자리 저장·되돌리기(viewmodel/task-map.js), Workflow 편집의 단계 목록 연산.
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
  const { run } = load(["model/task-map.js"]);
  const tasks = [
    { id: "done", status: "completed", updated: 50 }, { id: "back-old", status: "backlog", updated: 1 },
    { id: "run", status: "running", updated: 10 }, { id: "wait", status: "waiting_approval", updated: 5 },
    { id: "back-new", status: "backlog", updated: 9 }, { id: "ready", status: "ready", updated: 3 }, { id: "held", status: "blocked", updated: 7 },
    { id: "custom", status: "qa-1", updated: 8 },
  ];
  const ids = plain(run("umapOrderTasks").call(null, tasks).map(({ id }) => id));
  assert.deepEqual(ids, ["held", "wait", "run", "back-new", "custom", "ready", "back-old", "done"]);
});

test("auto layout: one band per project, task card left, stages to the right, sessions under their stage, done task one line", () => {
  const { run } = load(["model/task-map.js"]);
  const U = run("UMAP");
  const bands = [
    { key: "project:a", tasks: [
      { id: "t1", stages: [{ id: "plan", sessions: [{ id: "s1", compact: false }, { id: "s2", compact: true }] }, { id: "work", sessions: [] }] },
      { id: "t2", collapsed: true, stages: [{ id: "plan", sessions: [{ id: "s3" }] }] },
    ], free: [{ folder: "C:/w/a", sessions: [{ id: "f1", compact: true }] }] },
    { key: "folder:c:/w/b", collapsed: true, tasks: [{ id: "t3", stages: [] }], free: [] },
  ];
  const layout = run("umapLayout").call(null, bands, {});
  const box = (key) => layout.boxes[key];
  assert.equal(layout.bands.length, 2);
  assert.equal(box("task:t1").x, U.PAD);
  assert.equal(box("stage:t1:plan").x, U.STAGE_X);
  assert.equal(box("stage:t1:work").x, U.STAGE_X + U.STAGE_W + U.STAGE_GAP);
  assert.equal(box("stage:t1:plan").y, box("task:t1").y, "stages share the task row");
  assert.equal(box("sess:s1").x, box("stage:t1:plan").x, "a session sits right under its stage");
  assert.equal(box("sess:s1").y, box("stage:t1:plan").y + U.STAGE_H + U.SESS_TOP);
  assert.equal(box("sess:s2").y, box("sess:s1").y + U.SESS_H + U.SESS_GAP);
  assert.equal(box("sess:s2").h, U.CHIP_H, "finished sessions shrink to chips");
  assert.equal(box("task:t2").h, U.DONE_H, "a completed task collapses to one line");
  assert.equal(box("stage:t2:plan"), undefined);
  assert.ok(box("sess:f1").y > box("task:t2").y, "sessions without a task follow the task rows inside the band");
  assert.equal(box("task:t3"), undefined, "a collapsed band only shows its header");
  assert.ok(layout.bands[1].y >= layout.bands[0].y + layout.bands[0].h, "bands stack without overlap");
  assert.deepEqual(plain(layout.links.filter(({ from }) => from === "stage:t1:plan").map(({ to }) => to)).sort(), ["sess:s1", "sess:s2", "stage:t1:work"]);
});

test("a moved card keeps its manual spot inside its band while the rest stays auto-laid-out, and reset returns it", () => {
  const { run, store } = load(["model/task-map.js", "viewmodel/task-map.js"]);
  const bands = [{ key: "project:a", tasks: [{ id: "t1", stages: [{ id: "plan", sessions: [{ id: "s1" }] }] }], free: [] },
    { key: "project:b", tasks: [{ id: "t2", stages: [] }], free: [] }];
  const auto = run("umapLayout").call(null, bands, {});
  run("umapSetManual")("sess:s1", "project:a", 900.4, 40);
  const saved = JSON.parse(store.get("omp-umap-manual-v1"));
  assert.deepEqual(saved["sess:s1"], { band: "project:a", dx: 900, dy: 40 });
  const manual = run("UM").manual;
  const moved = run("umapLayout").call(null, bands, { manual });
  assert.equal(moved.boxes["sess:s1"].x, 900);
  assert.equal(moved.boxes["sess:s1"].y, moved.bands[0].y + 40);
  assert.equal(moved.boxes["sess:s1"].manual, true);
  assert.deepEqual([moved.boxes["task:t1"].x, moved.boxes["stage:t1:plan"].x], [auto.boxes["task:t1"].x, auto.boxes["stage:t1:plan"].x], "others stay auto");
  // 띠 순서가 바뀌어도 옮긴 카드는 자기 띠를 따라간다.
  const below = run("umapLayout").call(null, [bands[1], bands[0]], { manual });
  assert.equal(below.boxes["sess:s1"].y, below.bands[1].y + 40);
  assert.equal(run("umapIsManual")("sess:s1"), true);
  assert.equal(run("umapResetManual")("sess:s1"), true);
  assert.equal(JSON.parse(store.get("omp-umap-manual-v1"))["sess:s1"], undefined);
  const reset = run("umapLayout").call(null, bands, { manual: run("UM").manual });
  assert.deepEqual([reset.boxes["sess:s1"].x, reset.boxes["sess:s1"].y], [auto.boxes["sess:s1"].x, auto.boxes["sess:s1"].y]);
  // 전체 되돌리기와 띠 단위 되돌리기.
  run("umapSetManual")("task:t1", "project:a", 10, 10);
  run("umapSetManual")("task:t2", "project:b", 10, 10);
  run("umapResetAllManual")("project:a");
  assert.deepEqual(plain(Object.keys(run("UM").manual)), ["task:t2"]);
  run("umapResetAllManual")();
  assert.deepEqual(plain(Object.keys(run("UM").manual)), []);
});

test("band order and collapse persist, saved manual spots are read back on load", () => {
  const first = load(["model/task-map.js", "viewmodel/task-map.js"]);
  first.run("umapMoveBand")("project:b", -1, ["project:a", "project:b", "folder:x"]);
  first.run("umapToggleBand")("folder:x");
  first.run("umapSetManual")("task:t1", "project:a", 5, 6);
  const second = load(["model/task-map.js"], {});
  for (const [key, value] of first.store) second.context.localStorage.setItem(key, value);
  vm.runInContext(fs.readFileSync(path.join(UI, "viewmodel/task-map.js"), "utf8"), second.context);
  assert.deepEqual(plain(second.run("UM").order), ["project:b", "project:a", "folder:x"]);
  assert.equal(second.run("UM").collapsed.has("folder:x"), true);
  assert.deepEqual(plain(second.run("UM").manual["task:t1"]), { band: "project:a", dx: 5, dy: 6 });
  const ordered = second.run("umapOrderBands")([{ key: "folder:x" }, { key: "project:a" }, { key: "project:b" }, { key: "new" }], second.run("UM").order);
  assert.deepEqual(plain(ordered.map(({ key }) => key)), ["project:b", "project:a", "folder:x", "new"]);
});

test("Workflow 편집 list operations insert, move and remove stage ids", () => {
  const { run } = load(["model/task-map.js"]);
  const ids = ["plan", "work", "ok"];
  assert.deepEqual(plain(run("umapInsertStage")(ids, 1, "review")), ["plan", "review", "work", "ok"]);
  assert.deepEqual(plain(run("umapMoveStage")(ids, "ok", 0)), ["ok", "plan", "work"]);
  assert.deepEqual(plain(run("umapRemoveStage")(ids, "work")), ["plan", "ok"]);
  const U = run("UMAP");
  assert.equal(run("umapDropIndex")(U.STAGE_X + 2 * (U.STAGE_W + U.STAGE_GAP) + 10, 3), 2);
  assert.equal(run("umapDropIndex")(-500, 3), 0);
});

test("sessions are joined to stages by the runtime session id and unlinked ones stay in their project band", () => {
  const { run, context } = load(["model/monitor.js", "model/task-map.js", "viewmodel/task-map.js"], { askPending: () => false });
  const node = (sid, cwd, status = "done") => ({ id: "file-" + sid, kind: "main", sid, cwd, status });
  context.DATA = { sessions: [
    { key: "k1", title: "plan session", nodes: [node("sid-1", "C:/w/shop")] },
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
  assert.equal(stage.sessions[1].node, null, "a recorded session that is not on this PC stays a placeholder chip");
  assert.deepEqual(plain(shop.free.flatMap(({ sessions }) => sessions.map(({ id }) => id))), ["file-sid-2"], "linked sessions are not repeated as free sessions");
  assert.equal(shop.free[0].sessions[0].compact, false, "a live session is a full card");
  assert.equal(shop.tasks[0].collapsed, true);
  assert.ok(bands.some(({ key, project }) => key === "folder:c:/w/notes" && project === null), "sessions outside projects get their own folder band");
});
