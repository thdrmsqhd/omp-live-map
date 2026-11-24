"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { openDatabase, backup, transaction } = require("../server/engineering/database");
const { catalog } = require("../server/engineering/catalog");
const { runStore } = require("../server/engineering/run-store");
const { loopEngine } = require("../server/engineering/loop");
const { secureRunner } = require("../server/engineering/runner");
const { worktrees } = require("../server/engineering/worktree");

async function fixture(t, directory) {
  const root = path.join(directory, "source");
  await fs.mkdir(root);
  for (const args of [["init", "-b", "main"], ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
    "commit", "--allow-empty", "-m", "start"]]) execFileSync("git", args, { cwd: root });
  const file = path.join(directory, "db.sqlite");
  const db = openDatabase(file);
  t.after(() => db.close());
  const definitions = catalog(db);
  const project = await definitions.saveProject({ root, name: "fixture", branch: "main" });
  const model = definitions.saveDefinition({ project: project.id, kind: "model",
    payload: { name: "fixture model", provider: "fixture", model: "fake-1" } });
  const harness = definitions.saveDefinition({ project: project.id, kind: "harness",
    payload: { name: "fixture harness", adapter: "omp", model: model.id, role: "developer" } });
  const loop = definitions.saveDefinition({ project: project.id, kind: "loop",
    payload: { name: "fixture loop", harness: harness.id, attempts: 4, timeoutMs: 15000, budgetCents: 4,
      checks: [{ command: "node", args: ["verify.js"], code: 0 }] } });
  return { db, file, definitions, model, harness, loop, root, project,
    body: { project: project.id, definition: loop.id, title: "verify", instruction: "repair" },
    store: runStore(db, definitions) };
}

async function awaitStatus(store, id, status) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const state = store.get(id);
    if (state.status === status) return state;
    if (["blocked", "cancelled", "failed", "interrupted", "succeeded", "limit_exceeded"].includes(state.status)) {
      assert.fail(`Expected ${status}, got ${state.status}: ${JSON.stringify(store.attempts(id))}`);
    }
    await delay(20);
  }
  assert.fail("Run timed out in test");
}

test("versioned definitions, transactional recovery, backups, and run idempotency", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-db-"));
  try {
    const { db, file, definitions, model, project, harness, body, store } = await fixture(t, directory);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    assert.throws(() => definitions.remove(model.id), /referenced/);
    const newer = definitions.saveDefinition({ id: model.id, version: 1, project: project.id, kind: "model",
      payload: { ...model.payload, model: "fake-2" } });
    assert.equal(newer.version, 2);
    assert.equal(definitions.dependency(harness).payload.model, "fake-1");

    const key = randomUUID();
    const { run } = store.create(body, key);
    assert.equal(store.create(body, key).run.id, run.id);
    assert.throws(() => store.create({ ...body, title: "different" }, key), /different request/);
    assert.throws(() => store.change(run.id, "succeeded"), /Invalid run transition/);
    store.change(run.id, "running");
    assert.equal(store.startAttempt(run.id), 1);

    const copy = path.join(directory, "copy.sqlite");
    backup(db, copy);
    assert.throws(() => backup(db, copy), /EEXIST/);
    const restored = openDatabase(copy);
    const reopened = openDatabase(file);
    try {
      assert.equal(runStore(restored, catalog(restored)).get(run.id).status, "running");
      const recovery = runStore(reopened, catalog(reopened));
      recovery.recover();
      recovery.recover();
      assert.equal(recovery.get(run.id).status, "interrupted");
      assert.equal(recovery.attempts(run.id)[0].status, "uncertain");
      assert.throws(() => recovery.change(run.id, "running"), /Invalid run transition/);
      const first = recovery.events(0);
      assert.deepEqual(recovery.events(first[1].seq), first.slice(2));
      assert.throws(() => transaction(reopened, () => {
        reopened.prepare("DELETE FROM event").run();
        throw new Error("rollback");
      }), /rollback/);
      assert.deepEqual(recovery.events(0), first);
    } finally {
      reopened.close();
      restored.close();
    }
  } finally {
    // node:test closes the first connection before cleaning the fixture on Windows.
    t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  }
});

test("verified fixture runner fails checks twice, succeeds, and preserves a dirty worktree", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-loop-"));
  try {
    const { body, definitions, project, store, root } = await fixture(t, directory);
    const tools = worktrees(path.join(directory, "worktrees"));
    const feedback = [];
    const agent = {
      enforced: true, supports: () => true,
      async run(context) {
        feedback.push(context.feedback);
        await fs.writeFile(path.join(context.cwd, "verify.js"), `process.exit(${feedback.length < 3 ? 1 : 0});`);
        return { costCents: 1, sessionId: "fixture-" + feedback.length };
      },
    };
    const commands = {
      enforced: true,
      allows: ({ command, args }) => command === "node" && args.join(" ") === "verify.js",
      async execute(check, cwd) {
        try {
          execFileSync(process.execPath, check.args, { cwd, timeout: 3000 });
          return { code: 0, elapsedMs: 0, log: "verified" };
        } catch (error) {
          return { code: error.status, elapsedMs: 0, log: "api_key=secret-value" };
        }
      },
    };
    const engine = loopEngine(store, definitions, secureRunner(new Map([["omp", agent]]), commands), tools);
    const key = randomUUID();
    const run = engine.start(body, key);
    assert.equal(engine.start(body, key).id, run.id);
    const result = await awaitStatus(store, run.id, "succeeded");
    const attempts = store.attempts(run.id);
    assert.deepEqual(attempts.map(({ status }) => status), ["rejected", "rejected", "passed"]);
    assert.equal(feedback[1][0].log, "api_key=[redacted]");
    assert.equal(attempts[2].outcome.sessionId, "fixture-3");
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
    await assert.rejects(tools.remove(project, result.workspace), /local changes/);

    const unavailable = loopEngine(store, definitions, secureRunner(), tools);
    const blocked = unavailable.start(body, randomUUID());
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.workspace, null);
    assert.deepEqual(store.attempts(blocked.id), []);
  } finally {
    t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  }
});

test("active Loop cancels without another attempt and budget blocks verification", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-controls-"));
  try {
    const { body, definitions, store } = await fixture(t, directory);
    const tools = worktrees(path.join(directory, "worktrees"));
    let verified = 0;
    const commands = { enforced: true, allows: () => true, async execute() { verified++; return { code: 0 }; } };
    const agent = { enforced: true, supports: () => true,
      async run({ signal }) {
        await delay(5000, null, { signal });
        return { costCents: 0 };
      },
    };
    const engine = loopEngine(store, definitions, secureRunner(new Map([["omp", agent]]), commands), tools);
    const cancelled = engine.start(body, randomUUID());
    const deadline = Date.now() + 3000;
    while (!store.attempts(cancelled.id).length && Date.now() < deadline) await delay(15);
    assert.equal(store.attempts(cancelled.id).length, 1);
    engine.action(cancelled.id, "cancel");
    await awaitStatus(store, cancelled.id, "cancelled");
    assert.deepEqual(store.attempts(cancelled.id).map(({ status }) => status), ["cancelled"]);

    agent.run = async () => ({ costCents: 5 });
    const limited = engine.start(body, randomUUID());
    await awaitStatus(store, limited.id, "limit_exceeded");
    assert.equal(store.attempts(limited.id)[0].outcome.costCents, 5);
    assert.equal(verified, 0);
  } finally {
    t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  }
});
