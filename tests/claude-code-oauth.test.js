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

test("an expired subscription login is reported as a login expiry by the broker and the Claude adapter", async (t) => {
  const { LOGIN_EXPIRED } = require("../server/engineering/claude-code-oauth");
  const expired = await login({ accessToken: token, expiresAt: Date.now() - 1000, scopes: ["user:inference"] });
  t.after(() => fs.rm(expired, { recursive: true, force: true }));
  const model = "claude-sonnet-5-5";
  const body = JSON.stringify({ model, max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
  // 로그인 파일의 만료 시각이 지났으면 호출하지 않고 만료로 기록한다.
  const broker = createAnthropicBroker({ model, budgetCents: 1000, oauth: claudeCodeLogin({ directory: expired }).accessToken,
    upstream: async () => assert.fail("expired login must not reach Anthropic") });
  await assert.rejects(broker.request({ path: "/v1/messages", method: "POST", body }), (error) => error.code === LOGIN_EXPIRED);
  assert.equal(broker.failure(), LOGIN_EXPIRED);
  // 만료 시각 전이라도 Anthropic 이 구독 토큰을 거부(401)하면 만료로 본다. API 키는 구독 만료로 보지 않는다.
  const refused = createAnthropicBroker({ model, budgetCents: 1000, oauth: savedToken(token),
    upstream: async () => Response.json({ type: "error", error: { type: "authentication_error" } }, { status: 401 }) });
  await assert.rejects(refused.request({ path: "/v1/messages", method: "POST", body }), /HTTP 401/);
  assert.equal(refused.failure(), LOGIN_EXPIRED);
  const keyed = createAnthropicBroker({ model, budgetCents: 1000, key: "sk-ant-api03-" + "b".repeat(40),
    upstream: async () => new Response("{}", { status: 401 }) });
  await assert.rejects(keyed.request({ path: "/v1/messages", method: "POST", body }));
  assert.equal(keyed.failure(), null);

  // 실행기는 CLI 의 일반 실패 대신 'Claude Code 로그인 만료'로 실패한다.
  const { spawn } = require("node:child_process");
  const { adaptersFor } = require("../server/engineering/adapters");
  const backend = { enforced: true, supports: () => true, terminate: (child) => child.kill(),
    launch: (program, args, options) => Object.assign(spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options),
      { failure: () => LOGIN_EXPIRED }) };
  await assert.rejects(adaptersFor(backend).get("claude").run({ model: { provider: "anthropic", model }, cwd: expired,
    harness: { adapter: "claude", role: "reviewer" }, instruction: "fixture", feedback: [], budgetCents: 4, signal: AbortSignal.timeout(5000) }),
  /^Error: Claude Code 로그인 만료/);
});

test("the runtime status re-reads the Claude Code login and reports its expiry", () => {
  const { liveAuthState } = require("../server/engineering/runtime");
  const { LOGIN_EXPIRED } = require("../server/engineering/claude-code-oauth");
  let until = Date.now() + 3600000;
  const claudeCode = { describe() {
    if (until < Date.now()) throw Object.assign(new Error("Claude Code 로그인 만료 · fixture"), { code: LOGIN_EXPIRED });
    return { plan: "max", expiresAt: until };
  } };
  const auth = { kind: "claude-code-login", billing: "subscription", expiresAt: null };
  assert.equal(liveAuthState("ready", auth, claudeCode), null);
  assert.equal(auth.expiresAt, until);
  // Claude Code 가 갱신하면 새 만료 시각을 그대로 보여 준다.
  until += 7200000;
  assert.equal(liveAuthState("ready", auth, claudeCode), null);
  assert.equal(auth.expiresAt, until);
  until = Date.now() - 1000;
  assert.deepEqual(liveAuthState("ready", auth, claudeCode), { status: "login-expired", detail: "Claude Code 로그인 만료 · fixture" });
  // 다른 인증 수단이나 준비되지 않은 상태는 건드리지 않는다.
  assert.equal(liveAuthState("ready", { kind: "api-key", billing: "api" }, claudeCode), null);
  assert.equal(liveAuthState("missing-key", auth, claudeCode), null);
});
test("a call refused by the reservation budget is reported as budget exhaustion, not a generic broker denial", async () => {
  const { brokerFailure, BUDGET_EXHAUSTED } = require("../server/engineering/anthropic");
  const model = "claude-sonnet-5-5";
  const broker = createAnthropicBroker({ model, budgetCents: 1, oauth: savedToken(token),
    upstream: async (url) => url.endsWith("count_tokens") ? Response.json({ input_tokens: 10 }) : assert.fail("must not dispatch") });
  await assert.rejects(broker.request({ path: "/v1/messages", method: "POST",
    body: JSON.stringify({ model, max_tokens: 8192, messages: [{ role: "user", content: "hi" }] }) }), /budget exhausted/);
  assert.equal(broker.failure(), BUDGET_EXHAUSTED);
  assert.match(brokerFailure(BUDGET_EXHAUSTED).message, /^실행 예산 소진/);
});
