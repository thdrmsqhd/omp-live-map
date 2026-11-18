// 세션 요약: 지금 대화(마지막 10건)를 요약 모델에 맡기고, 실패하면 마지막 대화 발췌로 대신한다.
// omp·Claude 두 하네스의 기록 상태를 같은 방식으로 읽는다(요약은 하네스와 무관하다).
"use strict";

const { stateOf } = require("./tail");
const lineage = require("./lineage");
const claude = require("./harness/claude");
const { apiChat } = require("./models");

// 카드 id·실제 파일 어느 쪽으로 와도 그 세션의 기록 상태를 찾는다.
function stateFor(node) {
  const card = lineage.cardOf(node) || node;
  const file = lineage.resolve(card);
  return stateOf(file) || stateOf(card) || claude.stateOf(file) || claude.stateOf(card);
}

function excerpt(st) {
  const parts = (st.messages || []).slice(-6).map((m) => {
    const who = m.role === "user" ? "사용자" : "에이전트";
    return who + ": " + String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  }).filter((s) => !s.endsWith(":"));
  return parts.length ? "[대화 발췌]\n" + parts.join("\n") : "";
}

async function summaryOf(node) {
  const st = stateFor(node);
  if (!st) return { ok: false, out: "세션 기록 없음" };
  const convo = (st.messages || []).slice(-10).map((m) => (m.role === "user" ? "사용자: " : "에이전트: ") + m.text).join("\n");
  const ctx = st.ctx ? `context ${st.ctx.promptTokens} tokens` : "context 정보 없음";
  try {
    const text = await apiChat(
      `아래 세션 대화를 보고, 에이전트가 지금 무엇을 이해하고 어떤 상태인지 한국어 3줄로 요약하라. 각 줄은 60자 이내.\n\n[${ctx}]\n${convo || "(대화 없음)"}`,
      700,
      "You summarize coding-session context. Reply in Korean with exactly 3 short bullet lines, no preamble."
    );
    return { ok: true, out: text };
  } catch (e) {
    const text = excerpt(st);
    return text ? { ok: true, out: text, degraded: true, err: String((e && e.message) || e) }
      : { ok: false, out: String((e && e.message) || e) };
  }
}

module.exports = { summaryOf, stateFor };
