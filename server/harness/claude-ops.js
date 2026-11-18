// Claude 카드의 압축·비우기: 압축은 슬래시 명령을 프롬프트로 보내고, 비우기는 계보로 카드 id 를 유지한 새 세션을 연다.
// 상태는 claude-run 과 lineage 가 소유하고 이 모듈은 조합만 한다.
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const lineage = require("../lineage");
const claude = require("./claude");
const run = require("./claude-run");

// 압축: -p 모드에서 `/compact [지시문]` 을 프롬프트로 보낸다(실제 지원 여부는 [미확인]).
function compact(node, text) {
  const t = String(text || "").trim();
  return run.prompt(node, "/compact" + (t ? " " + t : ""), []);
}

// 비우기: 카드 id 는 유지하고 계보에 다음 세션 파일을 적는다. 다음 실행이 그 새 id 로 시작한다.
function clear(node) {
  const card = lineage.cardOf(node) || node;
  if (run.isBusy(card)) return { ok: false, out: "에이전트가 도는 중입니다" };
  const file = lineage.resolve(card);
  const pend = claude.pendingOf(card);
  const st = claude.stateOf(file) || claude.stateOf(card);
  const cwd = (pend && pend.cwd) || (st && st.cwd && fs.existsSync(st.cwd) ? st.cwd : process.cwd());
  const next = claude.fileFor(cwd, crypto.randomUUID());
  const key = lineage.sessionKeyOf(card) || (st && st.sessionKey) || undefined;
  lineage.record(card, next, key);
  claude.beginPending({ card, file: next, cwd, title: (st && st.title) || (pend && pend.title) || "", key });
  return { ok: true, mode: "clear", node: card, file: next, out: "대화 컨텍스트를 비웠습니다" };
}

module.exports = { compact, clear };
