"use strict";

const models = new Set(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
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

function createAnthropicBroker({ model, key, oauth, budgetCents, signal, upstream = fetch }) {
  let remaining = budgetCents;
  function call(path, body, headers) {
    return upstream(endpoint + path, { method: "POST", headers, body: JSON.stringify(body),
      redirect: "error", signal });
  }
  return {
    async request(input) {
      if (!key && !oauth) throw new Error("Anthropic authentication is required on the desktop host");
      if (typeof input.body !== "string" || input.body.length > 1024 * 1024) throw new Error("Model request is too large");
      const { path, body } = checkedRequest(input, model);
      const headers = { "content-type": "application/json", "anthropic-version": key ? "2023-06-01" : "2026-10-21" };
      if (key) headers["x-api-key"] = key;
      else headers.authorization = "Bearer " + await oauth(signal);
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
      if (!Number.isFinite(remaining) || reserve > remaining) throw new Error("Loop model budget exhausted");
      remaining -= reserve;
      return call(path, body, headers);
    },
    spent: () => budgetCents - remaining,
  };
}

module.exports = { createAnthropicBroker, models };
