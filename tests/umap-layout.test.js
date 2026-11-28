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

test("auto layout: one band per project, task card left, stages to the right, agent trees under their stage, nothing collapses", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const U = run("UMAP"), A = run("UMAP_AGENT");
  const bands = [
    { key: "project:a", tasks: [
      { id: "t1", stages: [{ id: "plan", sessions: [{ id: "s1", node: {}, children: [] }, { id: "s2", node: {} }] }, { id: "work", sessions: [] }] },
      { id: "t2", status: "completed", collapsed: true, stages: [{ id: "plan", sessions: [{ id: "s3", node: {}, compact: true }] }] },
    ], free: [{ folder: "C:/w/a", sessions: [{ id: "f1", node: {} }] }] },
    { key: "folder:c:/w/b", collapsed: true, tasks: [{ id: "t3", stages: [] }], free: [] },
  ];
  const layout = run("umapLayout").call(null, bands, {});
  const box = (key) => layout.boxes[key];
  assert.equal(layout.bands.length, 2);
  assert.equal(box("task:t1").x, U.PAD);
  assert.equal(box("stage:t1:plan").x, U.STAGE_X);
  assert.equal(box("stage:t1:work").x, box("stage:t1:plan").x + box("stage:t1:plan").w + U.STAGE_GAP, "the next stage starts after the previous column");
  assert.equal(box("stage:t1:plan").y, box("task:t1").y, "stages share the task row");
  assert.equal(box("sess:s1").x, box("stage:t1:plan").x, "an agent sits right under its stage");
  assert.equal(box("sess:s1").y, box("stage:t1:plan").y + U.STAGE_H + U.SESS_TOP);
  const H = run("umapAgentHeight")(null);
  assert.equal(box("sess:s2").y, box("sess:s1").y + H + A.GAP);
  assert.equal(box("sess:s2").h, H, "finished sessions keep their full card (no chips)");
  assert.equal(box("task:t2").h, U.TASK_H, "a completed task is laid out fully (dimmed by the view, not collapsed)");
  assert.ok(box("stage:t2:plan") && box("sess:s3"), "a completed task still shows its stages and agents");
  assert.ok(box("sess:f1").y > box("sess:s3").y, "sessions without a task follow the task rows inside the band");
  assert.ok(box("task:t3"), "old collapsed band flags are ignored");
  assert.ok(layout.bands[1].y >= layout.bands[0].y + layout.bands[0].h, "bands stack without overlap");
  assert.deepEqual(plain(layout.links.filter(({ from }) => from === "stage:t1:plan").map(({ to }) => to)).sort(), ["sess:s1", "sess:s2", "stage:t1:work"]);
});

test("subagent cards: nested children indent under their parent, widen the stage column, size to their sentences and never overlap", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const U = run("UMAP"), A = run("UMAP_AGENT");
  const lines = (recent) => ({ recent: Array.from({ length: recent }, (_, i) => ({ text: "r" + i })), counters: "읽음 1" });
  const leaf = (id, recent = 0) => ({ id, node: {}, lines: lines(recent), children: [] });
  const main = { id: "m", node: {}, lines: lines(3), children: [{ id: "a", node: {}, lines: lines(3), children: [leaf("a1", 1)] }, leaf("b", 2)] };
  const bands = [{ key: "project:a", tasks: [{ id: "t", stages: [{ id: "plan", sessions: [leaf("p0")] }, { id: "work", sessions: [main, leaf("m2")] }, { id: "ok", sessions: [] }] }],
    free: [{ folder: "C:/w", sessions: [{ id: "i", node: {}, lines: lines(3), children: [leaf("i1")] }, leaf("j"), leaf("k"), leaf("l"), leaf("m9"), leaf("n")] }] }];
  const layout = run("umapLayout").call(null, bands, {});
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
  assert.ok(A.W >= 320, "agent cards are wide enough for one readable sentence per line");
  assert.equal(String(run("umapLayout")).includes("level"), false, "the layout does not depend on the zoom level");
});

test("a moved card keeps its manual spot inside its band while the rest stays auto-laid-out, and reset returns it", () => {
  const { run, store } = load(["model/agent-lines.js", "model/task-map.js", "viewmodel/task-map.js"]);
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

test("band order persists, old collapse/expand keys are dropped, saved manual spots are read back on load", () => {
  const first = load(["model/agent-lines.js", "model/task-map.js", "viewmodel/task-map.js"]);
  first.run("umapMoveBand")("project:b", -1, ["project:a", "project:b", "folder:x"]);
  first.run("umapSetManual")("task:t1", "project:a", 5, 6);
  assert.equal(first.run("typeof umapToggleBand"), "undefined", "there is no band fold any more");
  assert.equal(first.run("typeof umapToggleExpanded"), "undefined", "there is no expand state any more");
  const second = load(["model/agent-lines.js", "model/task-map.js"], {});
  for (const [key, value] of first.store) second.context.localStorage.setItem(key, value);
  // 예전 버전이 저장한 띠 접힘 값
  const saved = JSON.parse(second.context.localStorage.getItem("omp-umap-bands-v1"));
  second.context.localStorage.setItem("omp-umap-bands-v1", JSON.stringify({ ...saved, collapsed: ["folder:x"] }));
  vm.runInContext(fs.readFileSync(path.join(UI, "viewmodel/task-map.js"), "utf8"), second.context);
  const UM = second.run("UM");
  assert.deepEqual(plain(UM.order), ["project:b", "project:a", "folder:x"]);
  assert.equal(UM.collapsed, undefined, "collapse state is gone");
  assert.equal(UM.expanded, undefined, "expand state is gone");
  assert.deepEqual(JSON.parse(second.context.localStorage.getItem("omp-umap-bands-v1")), { order: ["project:b", "project:a", "folder:x"] }, "the old collapsed key is migrated away");
  assert.deepEqual(plain(UM.manual["task:t1"]), { band: "project:a", dx: 5, dy: 6 });
  const ordered = second.run("umapOrderBands")([{ key: "folder:x" }, { key: "project:a" }, { key: "project:b" }, { key: "new" }], UM.order);
  assert.deepEqual(plain(ordered.map(({ key }) => key)), ["project:b", "project:a", "folder:x", "new"]);
});

test("fit: the whole map fits the viewport, small maps are enlarged and centred, the first view never opens below 70%", () => {
  const { run } = load(["model/agent-lines.js", "model/task-map.js"]);
  const fit = (content, view, opts) => plain(run("umapFitView")(content, view, opts));
  const small = fit({ width: 600, height: 300 }, { width: 1440, height: 800 });
  assert.equal(small.k, 1.25, "small content is enlarged up to 125% (it used to stay at 100%)");
  assert.equal(small.x, Math.round((1440 - 600 * 1.25) / 2), "and centred horizontally");
  const wide = fit({ width: 4000, height: 900 }, { width: 1440, height: 800 });
  assert.ok(Math.abs(wide.k - (1440 - 48) / 4000) < 0.001, "big content is shrunk until it fits");
  assert.ok(4000 * wide.k <= 1440 && 900 * wide.k <= 800, "everything is inside the viewport");
  const initial = (content) => plain(run("umapInitialView")(content, { width: 1440, height: 800 }));
  const first = initial({ width: 4000, height: 900 });
  assert.equal(first.k, 0.7, "the first view keeps a readable scale and starts top-left");
  assert.deepEqual([first.x, first.y], [24, 24]);
  assert.equal(initial({ width: 1674, height: 1426 }).k, 0.832, "the first view fits the width only; a tall map is scrolled, not shrunk");
  assert.equal(initial({ width: 600, height: 300 }).k, 1, "the first view never enlarges past 100%");
  assert.ok(fit({ width: 1, height: 1 }, { width: 1440, height: 800 }).k <= 1.25);
  assert.deepEqual(fit({ width: 0, height: 0 }, { width: 1440, height: 800 }), { x: 24, y: 24, k: 1 }, "an empty map stays at 100%");
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
