"use strict";

// 새 세션이 자원 부족으로 대기열에 들어가면 자리표시는 오류 대신 대기 사유를 보여 주고, 45초 시한 오류를 띄우지 않는다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Windows 체크아웃(core.autocrlf)은 CRLF 로 받으므로 줄 끝을 맞춘 뒤 함수를 잘라 낸다.
const source = fs.readFileSync(path.join(__dirname, "../ui/js/view/session-pending.js"), "utf8").replace(/\r\n/g, "\n");
const pick = (start) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, start);
  return source.slice(at, source.indexOf("\n}\n", at) + 3);
};

function context() {
  const cleared = [];
  const sandbox = {
    PENDS: [], AG: { W: 300 }, DEFER: false, pendingRender: false,
    renderMap: () => {}, clearTimeout: (t) => cleared.push(t),
    esc: (s) => String(s), cleared,
  };
  vm.createContext(sandbox);
  vm.runInContext([pick("function folderName("), pick("function dropPending("), pick("function settlePending("), pick("function pendingHTML(")].join("\n")
    + "\nthis.settlePending = settlePending; this.pendingHTML = pendingHTML;", sandbox);
  return sandbox;
}

test("a queued new session shows the wait reason instead of a timeout error", () => {
  const ui = context();
  const p = { id: "pend_1", x: 0, y: 0, cwd: "C:\\workspace\\xcore-site-ledger", node: null, err: "", timer: 7 };
  ui.PENDS.push(p);
  ui.settlePending(p, { ok: true, queued: true, node: "C:\\claude\\x.jsonl", out: "가용 RAM 부족 · 실행 대기", items: [] });
  assert.equal(p.node, "C:\\claude\\x.jsonl", "keeps the card id so the placeholder leaves when the card appears");
  assert.equal(p.err, "", "queued is not an error");
  assert.ok(ui.cleared.includes(7), "the 45s timeout no longer fires");
  assert.ok(ui.PENDS.includes(p), "the placeholder stays until the card appears");
  const html = ui.pendingHTML(p);
  assert.match(html, /실행 대기 중/);
  assert.match(html, /가용 RAM 부족/);
  assert.doesNotMatch(html, /열지 못했습니다/);
});

test("a started new session still waits for its card with the timeout armed", () => {
  const ui = context();
  const p = { id: "pend_2", x: 0, y: 0, cwd: "", node: null, err: "", timer: 9 };
  ui.PENDS.push(p);
  ui.settlePending(p, { ok: true, node: "C:\\claude\\y.jsonl" });
  assert.equal(p.node, "C:\\claude\\y.jsonl");
  assert.ok(!ui.cleared.includes(9));
  assert.match(ui.pendingHTML(p), /새 세션 여는 중/);
});
