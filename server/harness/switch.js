// 하네스 전환(A안 요약 이어받기): 원래 세션 요약 → 대상 하네스로 같은 cwd 새 세션 → 계보로 카드 id 유지.
// 원래 omp rpc 는 자원을 정리하고, 원래 기록은 lineage 가 숨긴다(비우기와 같은 규칙). 양방향 반복 가능.
"use strict";

const path = require("path");
const lineage = require("../lineage");
const harness = require("../harness");
const claude = require("./claude");
const claudeRun = require("./claude-run");
const sessions = require("../sessions");
const { summaryOf, stateFor } = require("../summary");

const errText = (e) => String((e && e.message) || e);

// 지금 카드의 실제 파일·하네스·작업 폴더.
function sourceOf(node) {
  const card = lineage.cardOf(node) || node;
  const file = lineage.resolve(card);
  const h = harness.of(file);
  const st = stateFor(card);
  const pend = claude.pendingOf(card);
  const cwd = (pend && pend.cwd) || (st && st.cwd) || process.cwd();
  return { card, file, harness: h, st, cwd };
}

// node: 카드 id(또는 실제 파일), target: "omp" | "claude".
async function switchHarness(node, target) {
  if (!harness.HARNESSES[target]) return { ok: false, out: "알 수 없는 하네스: " + target };
  const src = sourceOf(node);
  if (src.harness === target) return { ok: false, out: "이미 " + harness.HARNESSES[target].label + " 세션입니다" };
  if (sessions.busyOf(src.card)) return { ok: false, out: "에이전트가 도는 중입니다" };

  const sum = await summaryOf(src.card);
  if (!sum.ok) return { ok: false, out: "요약 생성 실패: " + sum.out };
  const label = harness.HARNESSES[src.harness].label;
  const text = `이전 세션(${label}, ${src.file})에서 이어받은 작업입니다.\n\n[요약]\n${sum.out}`;

  // 대상 세션을 먼저 띄운다. 실패하면 계보를 건드리지 않는다.
  const started = await sessions.newSession(src.cwd, text, [], target);
  if (!started.ok) return { ok: false, out: errText(started.out) };
  const next = path.normalize(started.node);
  const key = lineage.sessionKeyOf(src.card) || (src.st && src.st.sessionKey) || undefined;

  // 대상이 omp 면 맵 프로세스의 카드 키를 원래 카드 id 로 옮기고, 원래 omp 는 자원을 정리한다.
  if (target === "omp") sessions.adopt(next, src.card);
  else claudeRun.bind(src.card, src.cwd, next);
  if (src.harness === "omp") sessions.stopSession(src.card);

  lineage.record(src.card, next, key);
  // 새 파일을 바로 읽어 다음 스냅샷·SSE 가 같은 카드 id 로 그리게 한다(카드가 잠깐 사라지지 않게).
  require("../tail").scan();
  claude.scan();
  return { ok: true, node: src.card, file: next, harness: target, summary: sum.out, degraded: !!sum.degraded };
}

module.exports = { switchHarness };
