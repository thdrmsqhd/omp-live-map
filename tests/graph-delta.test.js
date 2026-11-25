"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),{makeDelta,applyDelta}=require("../server/graph-delta");
test("session delta handles updates, removals and reordering",()=>{const a={generatedAt:1,sessions:[{key:"a",title:"old"},{key:"b"},{key:"c"}]},b={generatedAt:2,sessions:[{key:"c"},{key:"a",title:"new"},{key:"d"}]};const d=makeDelta(a,b);assert.equal(d.upsert.length,2);assert.deepEqual(d.remove,["b"]);assert.deepEqual(applyDelta(a,d),b);});

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { encodeGraph, graphChanges, snapshotFrame, deltaFrame } = require("../server/graph-delta");
const { withLegacyHttp } = require("./helpers/legacy-http");

const parseFrame = (line) => JSON.parse(line.slice(6));

test("revisioned patches preserve unchanged nodes and reject an incorrect base", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ui/js/app.js"), "utf8");
  const applyPatch = vm.runInNewContext(source.slice(0, source.indexOf("async function boot()")) + "\napplyGraphPatch");
  const shared = { id: "shared", res: { cpu: 0 } };
  const unchanged = { id: "unchanged" };
  const before = { generatedAt: 1, sessions: [{ key: "a", nodes: [shared, unchanged, { id: "removed" }] }, { key: "gone", nodes: [] }] };
  const old = encodeGraph(before, 4);
  const bootstrap = parseFrame(snapshotFrame(old, 2));
  shared.res.cpu = 1;
  const after = { generatedAt: 2, sessions: [{ key: "new", nodes: [] }, { key: "a", nodes: [unchanged, shared] }] };
  const next = encodeGraph(after, 5);
  const changes = graphChanges(old, next);
  assert.ok(changes.changed);
  const patch = parseFrame(deltaFrame(old, next, changes, 2)).graphPatch;
  assert.deepEqual(patch.sessions.find(({ key }) => key === "a").upsert, [shared]);
  assert.deepEqual(patch.remove, ["gone"]);
  const result = applyPatch(bootstrap, patch);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ...after, graphRevision: 5 });
  assert.equal(result.sessions[1].nodes[0], bootstrap.sessions[0].nodes[1]);
  assert.equal(applyPatch(result, patch), null);
  assert.deepEqual(applyDelta(before, parseFrame(deltaFrame(old, next, changes, 1)).graphDelta), after);
});

test("HTTP SSE negotiates graph patches, sends title-only changes and reconnects with a fresh graph", (t) => withLegacyHttp(t, async ({ config }) => {
  const { broadcast } = require("../server/sse");
  const { scan } = require("../server/tail");
  const dir = path.join(config.SESSIONS, "fixture");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "main.jsonl");
  const timestamp = new Date().toISOString();
  const addTitle = (title) => fs.appendFileSync(file, JSON.stringify({ type: "title", title, timestamp }) + "\n");
  addTitle("old");
  scan();
  const open = async (query) => {
    const res = await fetch(`http://127.0.0.1:${config.PORT}/api/events${query}`, { signal: AbortSignal.timeout(5000) });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    return {
      close: () => reader.cancel(),
      async next() {
        while (!buffer.includes("\n\n")) {
          const { value, done } = await reader.read();
          assert.equal(done, false);
          buffer += value;
        }
        const end = buffer.indexOf("\n\n");
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return parseFrame(frame);
      },
    };
  };
  const legacy = await open("");
  const v8 = await open("?graph=2");
  try {
    assert.equal((await legacy.next()).graphRevision, undefined);
    assert.equal((await v8.next()).graphRevision, 0);
    broadcast();
    const baseline = await v8.next();
    await legacy.next();
    addTitle("updated");
    scan();
    broadcast();
    const delta = (await v8.next()).graphPatch;
    assert.equal(delta.baseRevision, baseline.graphRevision);
    assert.equal(delta.sessions[0].upsert[0].title, "updated");
    assert.equal((await legacy.next()).graphDelta.upsert[0].title, "updated");
  } finally {
    await legacy.close();
    await v8.close();
  }
  const reconnected = await open("?graph=2");
  try {
    const snapshot = await reconnected.next();
    assert.equal(snapshot.graphRevision, 0);
    assert.equal(snapshot.sessions[0].title, "updated");
  } finally { await reconnected.close(); }
}));
