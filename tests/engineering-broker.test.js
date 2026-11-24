"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAnthropicBroker } = require("../server/engineering/anthropic");

test("Anthropic broker confines destination, model, credential and prepaid request budget", async () => {
  const calls = [];
  const key = "host-credential";
  const model = "claude-sonnet-4-6";
  const broker = createAnthropicBroker({ model, key, budgetCents: 10, upstream: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("count_tokens") ? Response.json({ input_tokens: 300 }) : Response.json({ type: "message" });
  } });
  const message = (body, endpoint = "/v1/messages") => ({
    path: endpoint, method: "POST", body: JSON.stringify({ model, messages: [{ role: "user", content: "check" }],
      max_tokens: 100, ...body }),
  });
  await assert.rejects(broker.request(message({}, "/v1/files")), /Only Anthropic/);
  await assert.rejects(broker.request(message({ model: "wrong" })), /selected Anthropic/);
  await assert.rejects(broker.request(message({ tools: [{ type: "web_fetch_20260309" }] })), /Remote tools/);
  assert.equal(calls.length, 0);
  assert.equal((await broker.request(message({ speed: "fast", mcp_servers: [{ url: "http://example.invalid" }] }))).ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[1].options.headers["x-api-key"], key);
  assert.equal(calls[1].options.redirect, "error");
  assert.equal("speed" in JSON.parse(calls[1].options.body), false);
  assert.equal("mcp_servers" in JSON.parse(calls[1].options.body), false);
  assert.ok(broker.spent() > 0);
  await assert.rejects(broker.request(message({})), /budget exhausted/);
  assert.equal(calls.length, 3);
});
