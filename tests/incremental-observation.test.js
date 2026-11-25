"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

test("incremental observation preserves queued work and resets rotated files", (t) => withLegacyHttp(t, async ({ config }) => {
  await t.test("watched files are retained while observation yields", async () => {
  const { createScanQueue, sessionFile } = require("../server/observation");
  const batches = [];
  let release;
  let entered;
  const firstScan = new Promise((resolve) => { entered = resolve; });
  const pause = new Promise((resolve) => { release = resolve; });
  const schedule = createScanQueue(async (batch) => {
    batches.push(batch);
    if (batches.length === 1) { entered(); await pause; }
  }, (error) => assert.fail(error));
  const first = schedule("one", "omp");
  await firstScan;
  schedule("two", "omp");
  schedule("two", "omp");
  schedule("three", "claude");
  release();
  await first;
  await schedule();
  assert.deepEqual(batches, [
    { full: false, dirty: [["one", "omp"]] },
    { full: false, dirty: [["two", "omp"], ["three", "claude"]] },
    { full: true, dirty: [] },
  ]);
  assert.equal(sessionFile("root", ["..", "outside.jsonl"].join(path.sep), "omp"), null);
  assert.equal(sessionFile("root", ["local", "one.jsonl"].join(path.sep), "omp"), null);
  assert.equal(sessionFile("root", path.join("repo", "parent", "subagents", "agent-x.meta.json"), "claude"),
    path.join("root", "repo", "parent.jsonl"));
  });

  await t.test("OMP rotation and truncation rebuild aggregates from the current file", async () => {
  const tail = require("../server/tail");
  const file = path.join(config.SESSIONS, "fixture", "session.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const title = (value) => JSON.stringify({ type: "title", title: value, timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(file, title("A longer title"));
  tail.scan();
  assert.equal(tail.stateOf(file).title, "A longer title");
  await fs.writeFile(file, title("short"));
  [...tail.track(file)];
  assert.equal(tail.stateOf(file).title, "short");
  assert.equal(tail.stateOf(file).offset, (await fs.stat(file)).size);
  const before = tail.stateOf(file);
  await fs.rename(file, file + ".old");
  await fs.writeFile(file, title("other"));
  [...tail.track(file)];
  assert.notEqual(tail.stateOf(file), before);
  assert.equal(tail.stateOf(file).title, "other");
  await fs.unlink(file);
  [...tail.track(file)];
  assert.equal(tail.stateOf(file), null);
  });
}));
