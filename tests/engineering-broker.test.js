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

test("Anthropic Console OAuth signs both requests without an API key and retains the budget guard", async () => {
  const model = "claude-sonnet-4-6";
  const signal = new AbortController().signal;
  const requests = [];
  let authentications = 0;
  const broker = createAnthropicBroker({
    model, signal, budgetCents: 10,
    oauth: async (received) => {
      assert.equal(received, signal);
      authentications += 1;
      return "fixture-access-token";
    },
    upstream: async (url, options) => {
      assert.equal(options.headers.authorization, "Bearer fixture-access-token");
      assert.equal(options.headers["x-api-key"], undefined);
      assert.equal(options.headers["anthropic-version"], "2026-10-21");
      assert.equal(options.redirect, "error");
      requests.push(url);
      return url.endsWith("count_tokens") ? Response.json({ input_tokens: 300 })
        : new Response("data: fixture\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  const input = { path: "/v1/messages", method: "POST", body: JSON.stringify({
    model, messages: [{ role: "user", content: "check" }], max_tokens: 100, stream: true,
  }) };
  await assert.rejects(broker.request({ ...input, path: "/v1/files" }), /Only Anthropic/);
  assert.equal(authentications, 0);
  assert.equal(await (await broker.request(input)).text(), "data: fixture\n\n");
  assert.equal(authentications, 1);
  await assert.rejects(broker.request(input), /budget exhausted/);
  assert.deepEqual(requests, ["/v1/messages/count_tokens", "/v1/messages", "/v1/messages/count_tokens"]
    .map((path) => "https://api.anthropic.com" + path));
});
