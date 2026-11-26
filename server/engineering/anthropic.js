"use strict";

// 최신 모델을 앞에 둔다(모델 선택 목록이 이 순서로 나온다). 이전 모델은 이미 저장된 정의가 계속 실행되도록 남긴다.
const models = new Set(["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
  "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);
const { LOGIN_EXPIRED, AUTH_REJECTED, authError } = require("./claude-code-oauth");
const BUDGET_EXHAUSTED = "budget-exhausted";
// 브로커가 호출을 막은 이유를 실행 실패 사유로 바꾼다(CLI 에는 일반 거부로만 보인다).
function brokerFailure(code) {
  if (code !== BUDGET_EXHAUSTED) return authError(code);
  return Object.assign(new Error("실행 예산 소진 · 다음 모델 호출에 필요한 예약(호출 전에 토큰 수로 잡는 상한)이 남은 예산보다 큽니다. " +
    "예산(구독 로그인이면 '호출 예약 상한')을 늘려 다시 실행하세요."), { code });
}
const endpoint = "https://api.anthropic.com";
const inputCap = 100000;
const countFields = new Set(["model", "messages", "system", "tools", "tool_choice", "thinking"]);
const requestFields = new Set([...countFields, "max_tokens", "stream", "stop_sequences", "temperature",
  "top_p", "top_k", "metadata"]);
const deniedTypes = /^(url|file|web_search|web_fetch|computer|code_execution|bash_\d|text_editor_\d|mcp_)/;

function checkedRequest(request, model) {
  const path = request.path?.split("?")[0];
  if (request.method !== "POST" || !["/v1/messages", "/v1/messages/count_tokens"].includes(path)) {
    throw new Error("Only Anthropic message and token-count calls are available");
  }
  const body = JSON.parse(request.body);
  if (!body || body.model !== model || !models.has(model) || !Array.isArray(body.messages)) {
    throw new Error("The request must use the selected Anthropic model");
  }
  if (JSON.stringify(body, (key, value) => key === "type" && typeof value === "string" && deniedTypes.test(value)
    ? "OMP_BROKER_UNSUPPORTED_TYPE" : value).includes('"OMP_BROKER_UNSUPPORTED_TYPE"')) {
    throw new Error("Remote tools and external content sources are unavailable");
  }
  const fields = path.endsWith("count_tokens") ? countFields : requestFields;
  const clean = Object.fromEntries(Object.entries(body).filter(([key]) => fields.has(key)));
  if (path === "/v1/messages") {
    if (!Number.isSafeInteger(clean.max_tokens) || clean.max_tokens < 1) throw new Error("Missing maximum output tokens");
    clean.max_tokens = Math.min(clean.max_tokens, 8192);
  }
  return { path, body: clean };
}

// 컨테이너 안 CLI 가 보낸 베타 기능 이름 중 형식이 맞고 원격 도구·외부 자료를 열지 않는 것만 넘긴다.
// (본문의 원격 도구 타입은 checkedRequest 가 따로 막는다.)
const betaName = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const deniedBetas = /^(mcp|files-api|code-execution|web-|computer-use|skills|container)/;
function allowedBetas(value) {
  if (typeof value !== "string" || value.length > 2000) return [];
  return [...new Set(value.split(",").map((name) => name.trim().toLowerCase())
    .filter((name) => betaName.test(name) && !deniedBetas.test(name)))].slice(0, 24);
}

function createAnthropicBroker({ model, key, oauth, budgetCents, signal, upstream = fetch }) {
  let remaining = budgetCents;
  // 인증·예산 때문에 호출을 못 한 이유. CLI 에는 일반 거부로만 보이므로 실행기가 이 값으로 실패 사유를 남긴다.
  let failure = null;
  const rejected = (response) => {
    if (response.status === 401 && !key) failure ??= oauth?.subscription ? LOGIN_EXPIRED : AUTH_REJECTED;
    return response;
  };
  async function call(path, body, headers) {
    return rejected(await upstream(endpoint + path, { method: "POST", headers, body: JSON.stringify(body),
      redirect: "error", signal }));
  }
  return {
    async request(input) {
      if (!key && !oauth) throw new Error("Anthropic authentication is required on the desktop host");
      if (typeof input.body !== "string" || input.body.length > 1024 * 1024) throw new Error("Model request is too large");
      const { path, body } = checkedRequest(input, model);
      // Claude Code 구독 OAuth(claude-code-oauth.js)는 자기 API 버전을 달고 온다. Console OAuth 는 기존 버전을 쓴다.
      const headers = { "content-type": "application/json",
        "anthropic-version": key ? "2023-06-01" : oauth.apiVersion ?? "2026-10-21" };
      if (key) headers["x-api-key"] = key;
      else {
        try { headers.authorization = "Bearer " + await oauth(signal); } catch (error) {
          if (error.code === LOGIN_EXPIRED) failure ??= LOGIN_EXPIRED;
          throw error;
        }
      }
      const betas = allowedBetas(input.beta);
      if (betas.length) headers["anthropic-beta"] = betas.join(",");
      const countBody = Object.fromEntries(Object.entries(body).filter(([key]) => countFields.has(key)));
      const counted = await call("/v1/messages/count_tokens", countBody, headers);
      if (!counted.ok) {
        await counted.body?.cancel();
        throw new Error("Anthropic token count failed (HTTP " + counted.status + ")");
      }
      const count = (await counted.json()).input_tokens;
      if (!Number.isSafeInteger(count) || count < 0 || count > inputCap) throw new Error("Input token limit exceeded");
      if (path.endsWith("count_tokens")) return Response.json({ input_tokens: count });
      // Reserve an intentionally conservative allowance before dispatching the billable call.
      // Rates in USD per million tokens, including a margin for provider-added input/cache costs.
      const reserve = ((count + 1024) * 50 + body.max_tokens * 150) / 10000;
      if (!Number.isFinite(remaining) || reserve > remaining) {
        failure ??= BUDGET_EXHAUSTED;
        throw new Error("Loop model budget exhausted");
      }
      remaining -= reserve;
      return call(path, body, headers);
    },
    spent: () => budgetCents - remaining,
    failure: () => failure,
  };
}

module.exports = { createAnthropicBroker, models, allowedBetas, brokerFailure, BUDGET_EXHAUSTED };
