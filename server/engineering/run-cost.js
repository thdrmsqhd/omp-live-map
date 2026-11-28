"use strict";

// 실행 중 비용 누적기(순수, 파일·전역 상태 없음). 단계가 끝난 뒤가 아니라 도는 동안 예산을 지키려고
// 실행기(adapters.js)가 CLI 가 내는 이벤트를 하나씩 넘긴다. 금액 단위는 저장과 같은 센트(USD)다.
// - omp RPC: turn_end 의 message.usage.cost.total(USD)을 더한다.
// - claude stream-json: assistant 메시지마다 usage(토큰)를 message.id 로 모아(같은 메시지가 블록마다 거듭 온다)
//   가격표가 있으면 토큰 × 가격으로 계산한다. 가격표가 없으면 CLI 가 알려 준 누적(result.total_cost_usd)만 쓴다.
// 누적이 예산(budgetCents) 이상이 되면 over 가 참이다. 예산 0 이하는 '한도 없음'.

const BUDGET_REASON = "예산 초과";

// prices: { [model]: { input, output, cacheRead, cacheWrite } } — 100만 토큰당 USD.
function claudeUsd(usage, price) {
  if (!usage || !price) return 0;
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  return (n(usage.input_tokens) * n(price.input) + n(usage.output_tokens) * n(price.output) +
    n(usage.cache_read_input_tokens) * n(price.cacheRead ?? price.input) +
    n(usage.cache_creation_input_tokens) * n(price.cacheWrite ?? price.input)) / 1e6;
}

function runCost({ budgetCents = 0, model = "", prices = null } = {}) {
  const price = prices && model ? prices[model] || null : null;
  const messages = new Map(); // claude message.id → USD
  let ompCents = 0, claudeCents = 0, reportedCents = 0, valid = true;
  const state = {
    get cents() { return Math.max(ompCents, claudeCents, reportedCents); },
    get over() { return budgetCents > 0 && state.cents >= budgetCents; },
    get basis() { return reportedCents >= claudeCents ? "reported" : "estimated"; },
    get valid() { return valid; },
    // omp RPC 프레임. 돌려주는 값 = 지금 예산을 넘었는지.
    omp(frame) {
      if (!frame || frame.type !== "turn_end") return state.over;
      const usd = frame.message?.usage?.cost?.total;
      if (!Number.isFinite(usd) || usd < 0) valid = false;
      else ompCents += usd * 100;
      return state.over;
    },
    // claude stream-json 이벤트.
    claude(event) {
      if (!event) return state.over;
      if (event.type === "assistant" && price && event.message?.usage) {
        const id = String(event.message.id || "m" + messages.size);
        messages.set(id, claudeUsd(event.message.usage, price));
        claudeCents = [...messages.values()].reduce((sum, usd) => sum + usd, 0) * 100;
      }
      if (event.type === "result" && Number.isFinite(event.total_cost_usd) && event.total_cost_usd >= 0) {
        reportedCents = event.total_cost_usd * 100;
      }
      return state.over;
    },
  };
  return state;
}

// 예산을 넘겨 멈춘 실행의 오류. costCents 는 멈출 때까지 쓴 금액이다.
function budgetError(cents) {
  const error = new Error(BUDGET_REASON);
  error.budgetExceeded = true;
  error.costCents = cents;
  return error;
}

module.exports = { runCost, claudeUsd, budgetError, BUDGET_REASON };
