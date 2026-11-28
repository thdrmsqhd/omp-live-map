"use strict";

// 화면 한 단위 원화(core/format.js), 글꼴에 없는 글리프(Nerd Font PUA) 걷기(model/agent-lines.js umapPlain · server ingest title_change),
// 쉬는 타일의 최근 끝난 일 목록(viewmodel/task-map.js umapRecentDone).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const UI = path.join(__dirname, "../ui/js");
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(files, globals = {}) {
  const context = vm.createContext({ FX: 1390, DATA: { sessions: [] }, ALIAS: new Map(), viewUpdates: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, ...globals });
  vm.runInContext("const readJSON = (k, f) => f; const writeJSON = () => {};", context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(UI, file), "utf8"), context, { filename: file });
  return (code) => vm.runInContext(code, context);
}

test("money is shown in one unit (₩, FX = OMP_USD_KRW) and ₩ input converts back to stored cents", () => {
  const run = load(["core/format.js"]);
  assert.equal(run("krw")(1), "₩1,390");
  assert.equal(run("krw")(0), "₩0");
  assert.equal(run("krwCents")(6000), "₩83,400", "a $60.00 budget in cents");
  assert.equal(run("krwCents")(12.5), "₩174");
  assert.equal(run("wonOfCents")(300), 4170);
  const cents = run("centsOfWon");
  assert.equal(cents("₩83,400"), 6000);
  assert.equal(cents("83400"), 6000);
  assert.equal(cents("8만"), NaN);
  assert.equal(cents(" 1,390원 "), 100);
  assert.ok(Number.isNaN(cents("")), "empty is not zero — the caller decides what empty means");
  const other = load(["core/format.js"], { FX: 1000 });
  assert.equal(other("krwCents")(250), "₩2,500", "the rate comes from the server (OMP_USD_KRW)");
});

test("UI money paths do not print dollars", () => {
  const files = ["view/umap-render.js", "view/umap-drawer.js", "view/umap-click.js", "view/umap-library.js", "view/card-metrics.js"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(UI, file), "utf8");
    assert.doesNotMatch(text, /"\$"\s*\+|umapDollars|\(달러\)/, file + " still formats dollars");
  }
});

test("Nerd Font icons (PUA) are stripped from card titles, subtitles and lines", () => {
  const run = load(["model/agent-lines.js"]);
  const strip = run("umapPlain");
  assert.equal(strip("\u{F094C} MTIME: Check files modified yesterday"), "MTIME: Check files modified yesterday");
  assert.equal(strip("\uE0A0 main \u25A1\uFFFD"), "main");
  assert.equal(strip("한글 제목"), "한글 제목");
  const title = run("umapAgentTitle");
  assert.equal(title({ kind: "main", sessionTitle: "\u{F06A9} OPUS: Set Hermes" }), "OPUS: Set Hermes");
  assert.equal(title({ kind: "main", sessionTitle: "\u{F06A9}", title: "", firstUser: "첫 지시" }), "첫 지시", "a title that was only an icon falls through");
  assert.equal(title({ kind: "sub", name: "\uE7A8 Fixer" }), "Fixer");
  const lines = plain(run("umapAgentLines")({ kind: "main", status: "done", sessionTitle: "\u{F0A1B} 정리", act: { status: "done", goal: "\uF120 로그 정리", resultSummary: "\u{F012C} 끝났습니다" } }));
  assert.deepEqual([lines.title, lines.goal, lines.result], ["정리", "로그 정리", "끝났습니다"]);
});

test("omp title_change records set the session title without the icon", () => {
  const { newFileState, ingest } = require("../server/ingest");
  const { SESSIONS } = require("../server/config");
  const st = newFileState(path.join(SESSIONS, "--C--w--", "2026-11-01T00-00-00-000Z_01a.jsonl"));
  ingest(st, JSON.stringify({ type: "session", id: "01a", cwd: "C:/w", timestamp: "2026-11-01T00:00:00.000Z" }));
  ingest(st, JSON.stringify({ type: "title_change", title: "\u{F094C} MTIME: Check files", source: "auto", timestamp: "2026-11-01T00:00:01.000Z" }));
  assert.equal(st.title, "MTIME: Check files");
  ingest(st, JSON.stringify({ type: "title", title: "\u{F06A9} OPUS: renamed", timestamp: "2026-11-01T00:00:02.000Z" }));
  assert.equal(st.title, "OPUS: renamed");
});

test("idle tiles list the latest 2–3 finished items (Task runs and unlinked sessions), newest first", () => {
  const run = load(["model/agent-lines.js", "model/task-map.js", "viewmodel/task-map.js"], { askPending: () => false, capsOf: () => ({ label: "omp" }) });
  const main = (id, title, result, lastTs) => ({ key: "s-" + id, title, lastTs, nodes: [{ id, kind: "main", status: "idle", act: { status: "done", goal: "할 일", resultSummary: result } }] });
  const band = {
    tasks: [
      { title: "\u{F094C} 배포", updated: 10, run: { status: "succeeded", updated: 500 }, stages: [{ status: "succeeded", sessions: [{ node: { id: "linked" } }] }, { status: "succeeded", sessions: [] }] },
      { title: "도는 중", run: { status: "running", updated: 900 }, stages: [] },
      { title: "옛 실행", run: { status: "failed", updated: 300, legacy: true, error: "workspace 409" }, stages: [{ status: "failed", sessions: [] }] },
    ],
    sessions: [main("linked", "단계 세션", "x", 950), main("a", "대화 A", "A 끝", 800), main("b", "\uE0A0 대화 B", "B 끝", 100)],
  };
  const items = plain(run("umapRecentDone")(band, 3));
  assert.deepEqual(items.map(({ kind, title }) => kind + ":" + title), ["session:대화 A", "task:배포", "task:옛 실행"]);
  assert.deepEqual([items[1].done, items[1].total, items[1].status], [2, 2, "succeeded"]);
  assert.equal(items[0].result, "A 끝");
  assert.deepEqual([items[2].legacy, items[2].result], [true, ""], "a legacy run hides its raw 409 error (the view shows the Korean reason)");
  assert.equal(plain(run("umapRecentDone")(band, 2)).length, 2);
});
