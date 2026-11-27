"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const load = (file, context) => vm.runInContext(readFileSync(path.join(root, file), "utf8"), context, { filename: file });

test("E1/E3: duplicate ask SSE does not permit a second answer while one is in flight", async () => {
  let resolve, posts = 0;
  const notifications = [];
  const context = vm.createContext({
    liveNodeId: id => id,
    viewUpdates: { ask: id => notifications.push(id) },
    postJSON: async () => {
      posts++;
      return new Promise(done => { resolve = done; });
    }
  });
  load("ui/js/viewmodel/chat-ask.js", context);
  const request = () => ({ kind: "add", node: "node", request: { id: "q", method: "confirm" } });
  context.handleAskEvent(request());
  const first = context.askConfirm("node", "q", true);
  context.handleAskEvent(request());
  const second = await context.askConfirm("node", "q", false);
  assert.equal(second.duplicate, true);
  assert.equal(posts, 1);
  assert.deepEqual(notifications, ["node"]);
  resolve({ json: async () => ({ ok: true }) });
  assert.equal((await first).ok, true);
});

test("E3: failed answer can be retried and reports state via callback", async () => {
  let posts = 0, updates = 0;
  const context = vm.createContext({
    liveNodeId: id => id,
    viewUpdates: { chat: () => { updates++; } },
    postJSON: async () => ({ json: async () => (++posts === 1 ? { ok: false, out: "offline" } : { ok: true }) })
  });
  load("ui/js/viewmodel/chat-ask.js", context);
  context.handleAskEvent({ kind: "add", node: "n", request: { id: "q", method: "confirm" } });
  assert.equal((await context.askConfirm("n", "q", true)).ok, false);
  assert.equal(context.askFind("n", "q")._err, "offline");
  assert.equal(updates, 1);
  assert.equal((await context.askConfirm("n", "q", true)).ok, true);
  assert.equal(posts, 2);
});

test("F2: session strip preserves active session and pending question without mutating input", () => {
  const session = { key: "s", live: true, nodes: [{ id: "n", kind: "main" }] };
  const request = { id: "q" };
  const context = vm.createContext({ mapMode: "design", DATA: { sessions: [session] }, ASKS: new Map([["n", [request]]]) });
  load("ui/js/viewmodel/session-strip.js", context);
  const before = JSON.stringify([session, request]);
  const snapshot = context.sessionStripSnapshot();
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.sessions[0], session);
  assert.equal(snapshot.groups[0].list[0], request);
  assert.equal(JSON.stringify([session, request]), before);
  context.mapMode = "map";
  assert.equal(context.sessionStripSnapshot(), null);
});

test("D3: infrastructure host process backend has no engineering imports", () => {
  const source = readFileSync(path.join(root, "server/infrastructure/host-process.js"), "utf8");
  assert.doesNotMatch(source, /require\s*\(\s*["']\.\.\/engineering\//);
});
