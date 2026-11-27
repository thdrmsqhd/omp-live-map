"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { openDatabase, backup, transaction } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { runStore } = require("../server/engineering/run-store");
const { loopEngine } = require("../server/engineering/loop");
const { secureRunner } = require("../server/engineering/runner");
const { previewHarness } = require("../server/engineering/harness-preview");
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
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 13);
    assert.throws(() => definitions.remove(model.id), /referenced/);
    const newer = definitions.saveDefinition({ id: model.id, version: 1, project: project.id, kind: "model",
      payload: { ...model.payload, model: "fake-2" } });
    assert.equal(newer.version, 2);
    assert.equal(definitions.dependency(harness).payload.model, "fake-1");
    assert.throws(() => definitions.saveDefinition({ project: project.id, kind: "harness",
      payload: { ...harness.payload, name: "bad profile", assets: { mcp: { env: { API_KEY: "forbidden" } } } } }),
    /cannot contain credentials/);
    const saved = definitions.saveDefinition({ project: project.id, kind: "harness", id: harness.id, version: 1,
      payload: { ...harness.payload, assets: { agents: "Project instructions", skills: [{ name: "verify", markdown: "Run phased tests." }] } } });
    assert.equal(saved.payload.assets.skills[0].name, "verify");
    assert.deepEqual(definitions.versionOf(harness.id, 1).payload.assets.skills, []);
    assert.equal(definitions.dependency(saved).payload.model, "fake-2");
    const isolated = secureRunner();
    const previous = await previewHarness(definitions, isolated, { project: project.id, id: harness.id, version: 1 });
    assert.equal(previous.model.id, "fake-1");
    assert.equal(previous.ready, false);
    assert.match(previous.blockedReason, /verified isolation/);
    const draft = await previewHarness(definitions, isolated, { project: project.id, payload: saved.payload });
    assert.equal(draft.model.id, "fake-2");
    assert.deepEqual(draft.prompt.map(({ name }) => name), ["role", "assets"]);
    assert.match(draft.prompt[1].text, /Run phased tests/);
    assert.deepEqual(draft.assets, { mcp: "draft-only", hooks: "draft-only" });

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

test("harness source preview pins tracked content and checks workflow artifacts", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-harness-sources-"));
  const { definitions, harness, project, root } = await fixture(t, directory);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { resolveSources } = require("../server/engineering/harness-sources");
  const { artifactDigest } = require("../server/engineering/workflow-artifact");
  const tracked = path.join(root, "rules.md");
  await fs.writeFile(tracked, "Tracked review rules.\n");
  execFileSync("git", ["add", "rules.md"], { cwd: root });
  execFileSync("git", ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-m", "rules"], { cwd: root });
  await fs.writeFile(tracked, "Working directory edits.");
  const payload = { ...harness.payload, assets: { files: ["rules.md"], inputs: ["report"] } };
  const preview = await previewHarness(definitions, secureRunner(), { project: project.id, payload });
  assert.match(preview.prompt.at(-1).text, /Tracked review rules/);
  assert.equal(preview.sources[0].path, "rules.md");
  assert.match(preview.sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.workflowInputs, ["report"]);
  await assert.rejects(previewHarness(definitions, secureRunner(), {
    project: project.id, payload: { ...payload, assets: { files: ["../rules.md"] } },
  }), /repository-relative/);
  await assert.rejects(previewHarness(definitions, secureRunner(), {
    project: project.id, payload: { ...payload, assets: { files: ["missing.txt"] } },
  }), /not a tracked regular file/);
  await fs.writeFile(path.join(root, "test.txt"), "Passed tests.");
  const report = { input: "report", ...await artifactDigest(root, "test.txt") };
  const resolved = await resolveSources(payload, project, root, [report]);
  assert.equal(resolved[1].text, "Passed tests.");
  await fs.writeFile(path.join(root, "test.txt"), "Changed tests.");
  await assert.rejects(resolveSources(payload, project, root, [report]), /artifact changed/);
});

test("harness result validation detects missing JSON fields and accepts an empty findings list", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-harness-result-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { resultContract, verifyResult } = require("../server/engineering/harness-result");
  const contract = resultContract({ shape: "array", path: "review.json", fields: ["file", "line"] });
  assert.equal((await verifyResult(contract, directory)).passed, false);
  await fs.writeFile(path.join(directory, "review.json"), '[{"file":"main.js"}]');
  assert.match((await verifyResult(contract, directory)).errors[0], /line is missing/);
  await fs.writeFile(path.join(directory, "review.json"), "[]");
  assert.equal((await verifyResult(contract, directory)).passed, true);
  assert.throws(() => resultContract({ ...contract, path: "../review.json" }), /relative paths/);
});

test("harness comparison shares one commit and inputs, with isolated worktrees and budget", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-harness-trial-"));
  const { db, definitions, harness, project } = await fixture(t, directory);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { projectBudget } = require("../server/engineering/project-budget");
  const { harnessTrials } = require("../server/engineering/harness-trials");
  const budget = projectBudget(db);
  budget.save(project.id, { cap: 12, days: 1 });
  const work = worktrees(path.join(directory, "worktrees"));
  const actual = [];
  const runner = {
    requireAdapter() {
      return { async run(context) {
        actual.push({ cwd: context.cwd, instruction: context.instruction, sources: context.harness.resolvedSources,
          commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: context.cwd, encoding: "utf8" }).trim() });
        if (context.harness.result && actual.length > 2) {
          await fs.writeFile(path.join(context.cwd, context.harness.result.path), '[{"file":"main.js"}]');
        }
        return { sessionId: "fixture", costCents: 1, output: "done" };
      } };
    },
  };
  const compare = harnessTrials(definitions, runner, work, budget);
  const draft = { ...harness.payload, instructions: "Updated", assets: { inputs: ["report"] },
    result: { path: "review.json", shape: "array", fields: ["file"] } };
  const body = { key: "comparison", baseline: { id: harness.id, version: 1 }, payload: draft,
    instruction: "Review changes", materials: { report: "Tests passed" }, budgetCents: 6, timeoutMs: 4000 };
  const first = await compare.start(project.id, body);
  assert.equal((await compare.start(project.id, body)).id, first.id);
  assert.equal(budget.get(project.id).committed, 12);
  const deadline = Date.now() + 4000;
  while (compare.inspect(project.id, first.id).status === "running" && Date.now() < deadline) await delay(20);
  const end = compare.inspect(project.id, first.id);
  assert.equal(end.status, "finished");
  assert.equal(end.results.baseline.status, "succeeded");
  assert.equal(end.results.draft.status, "failed");
  assert.equal(end.results.draft.validation.passed, false);
  assert.equal(actual.length, 2);
  assert.equal(actual[0].commit, end.commit);
  assert.equal(actual[1].commit, end.commit);
  assert.notEqual(actual[0].cwd, actual[1].cwd);
  assert.equal(actual[0].instruction, actual[1].instruction);
  assert.equal(actual[1].sources[0].text, "Tests passed");
  assert.equal(budget.get(project.id).committed, 2);
  compare.retry(project.id, first.id, "draft");
  while (compare.inspect(project.id, first.id).status === "running" && Date.now() < deadline) await delay(20);
  const retried = compare.inspect(project.id, first.id);
  assert.equal(retried.results.draft.status, "succeeded");
  assert.deepEqual(retried.results.baseline, end.results.baseline);
  assert.equal(actual.length, 3);
  assert.equal(actual[2].commit, end.commit);
  assert.equal(budget.get(project.id).committed, 3);
  await assert.rejects(compare.start(project.id, { ...body, key: "over-budget" }), /budget would be exceeded/);
});
