"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { claudeCodeLogin, savedToken, isOAuthToken } = require("../server/engineering/claude-code-oauth");
const { createAnthropicBroker } = require("../server/engineering/anthropic");

const token = "sk-ant-oat01-" + "a".repeat(40);

async function login(oauth) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-claude-code-"));
  await fs.writeFile(path.join(directory, ".credentials.json"), JSON.stringify({ claudeAiOauth: oauth }));
  return directory;
}

test("Claude Code login supplies its current subscription token without exposing it in the description", async () => {
  const directory = await login({ accessToken: token, expiresAt: Date.now() + 3600000, scopes: ["user:inference"], subscriptionType: "max" });
  try {
    const source = claudeCodeLogin({ directory });
    assert.deepEqual(Object.keys(source.describe()).sort(), ["expiresAt", "plan"]);
    assert.equal(source.describe().plan, "max");
    assert.equal(await source.accessToken(), token);
    assert.equal(source.accessToken.apiVersion, "2023-06-01");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("an expired or inference-less Claude Code login is rejected with guidance", async () => {
  const expired = await login({ accessToken: token, expiresAt: Date.now() - 1000, scopes: ["user:inference"] });
  const limited = await login({ accessToken: token, expiresAt: Date.now() + 3600000, scopes: ["user:profile"] });
  try {
    await assert.rejects(claudeCodeLogin({ directory: expired }).accessToken(), /만료/);
    assert.throws(() => claudeCodeLogin({ directory: limited }).describe(), /user:inference/);
    assert.throws(() => claudeCodeLogin({ directory: path.join(expired, "missing") }).describe(), /로그인 정보를 찾을 수 없습니다/);
  } finally {
    await fs.rm(expired, { recursive: true, force: true });
    await fs.rm(limited, { recursive: true, force: true });
  }
});

test("a saved setup-token is used as OAuth while API keys stay API keys", async () => {
  assert.equal(isOAuthToken(token), true);
  assert.equal(isOAuthToken("sk-ant-api03-" + "b".repeat(40)), false);
  assert.equal(savedToken("sk-ant-api03-" + "b".repeat(40)), null);
  assert.equal(await savedToken(token)(), token);
});

test("the broker sends subscription OAuth with the standard API version", async () => {
  const model = "claude-sonnet-5-5";
  const seen = [];
  const broker = createAnthropicBroker({ model, budgetCents: 1000, oauth: savedToken(token), upstream: async (url, options) => {
    seen.push(options.headers);
    return url.endsWith("count_tokens") ? Response.json({ input_tokens: 10 }) : Response.json({ ok: true });
  } });
  await broker.request({ path: "/v1/messages", method: "POST", body: JSON.stringify({ model, max_tokens: 10,
    system: "You are Claude Code, Anthropic's official CLI for Claude.", messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(seen.length, 2);
  for (const headers of seen) {
    assert.equal(headers.authorization, "Bearer " + token);
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers["x-api-key"], undefined);
  }
});

test("the broker forwards only well-formed, non-remote beta features from the container CLI", async () => {
  const { allowedBetas } = require("../server/engineering/anthropic");
  assert.deepEqual(allowedBetas("interleaved-thinking-2025-05-14, context-management-2025-06-27,mcp-client-2025-04-04,files-api-2025-04-14"),
    ["interleaved-thinking-2025-05-14", "context-management-2025-06-27"]);
  assert.deepEqual(allowedBetas("web-fetch-2025-09-10,code-execution-2025-08-25,bad name,<x>"), []);
  assert.deepEqual(allowedBetas(undefined), []);
  const model = "claude-sonnet-5-5";
  const seen = [];
  const broker = createAnthropicBroker({ model, budgetCents: 1000, oauth: savedToken(token), upstream: async (url, options) => {
    seen.push(options.headers["anthropic-beta"]);
    return url.endsWith("count_tokens") ? Response.json({ input_tokens: 10 }) : Response.json({ ok: true });
  } });
  await broker.request({ path: "/v1/messages", method: "POST", beta: "context-management-2025-06-27,mcp-client-2025-04-04",
    body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
  assert.deepEqual(seen, ["context-management-2025-06-27", "context-management-2025-06-27"]);
});
