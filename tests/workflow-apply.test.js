"use strict";

// GitHub 없이 실행 결과를 작업 폴더에 그대로 반영한다. 실행 뒤 폴더에서 따로 고친 파일이 있으면 하나도 쓰지 않고 그 파일을 알린다.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { worktrees } = require("../server/engineering/worktree");
const { workflowDelivery } = require("../server/engineering/workflow-delivery");
const shadow = require("../server/engineering/shadow-repo");

async function setup(t, prepare) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-workflow-apply-"));
  shadow.configure(path.join(directory, "shadow"));
  const db = openDatabase(path.join(directory, "db.sqlite"));
  t.after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, "site");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "a.txt"), "one");
  await fs.writeFile(path.join(root, "keep.txt"), "keep");
  await fs.writeFile(path.join(root, "old.txt"), "old");
  if (prepare) prepare(root);
  const definitions = catalog(db);
  const project = await definitions.ensureProject({ root });
  const id = randomUUID(), workspaceRoot = path.join(directory, "worktrees");
  const workspace = await worktrees(workspaceRoot).create(project, { id });
  const run = { id, status: "succeeded", workspace, project: project.id, title: "apply" };
  const delivery = workflowDelivery(db, { get: () => run }, definitions, workspaceRoot);
  return { root, workspace, delivery, id };
}

async function agentEdits(workspace) {
  await fs.writeFile(path.join(workspace, "a.txt"), "two");
  await fs.mkdir(path.join(workspace, "new"));
  await fs.writeFile(path.join(workspace, "new", "c.txt"), "made");
  await fs.rm(path.join(workspace, "old.txt"));
  // 실행 보고서(.workflow-output)는 앱에서 보는 산출물이라 작업 폴더에 쓰지 않는다.
  await fs.mkdir(path.join(workspace, ".workflow-output"));
  await fs.writeFile(path.join(workspace, ".workflow-output", "review.md"), "report");
}

test("a plain folder receives the run's changed, new, and deleted files", async (t) => {
  const { root, workspace, delivery, id } = await setup(t);
  await agentEdits(workspace);
  const result = await delivery.applyToFolder(id);
  assert.deepEqual([...result.files].sort(), ["a.txt", "new/c.txt", "old.txt"]);
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "two");
  assert.equal(await fs.readFile(path.join(root, "new", "c.txt"), "utf8"), "made");
  assert.equal(existsSync(path.join(root, "old.txt")), false, "a file the run deleted is deleted");
  assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep");
  assert.equal(existsSync(path.join(root, ".git")), false, "the folder still has no .git");
  assert.equal(existsSync(path.join(root, ".workflow-output")), false, "run reports stay in the app");
  await delivery.applyToFolder(id); // 다시 눌러도 같은 결과다.
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "two");
});

test("a file changed in the folder after the run started blocks the whole apply", async (t) => {
  const { root, workspace, delivery, id } = await setup(t);
  await agentEdits(workspace);
  await fs.writeFile(path.join(root, "a.txt"), "user");
  await assert.rejects(delivery.applyToFolder(id), (error) => error.status === 409 && /a\.txt/.test(error.message));
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "user", "the user's edit stays");
  assert.equal(existsSync(path.join(root, "new", "c.txt")), false, "nothing is written when one file conflicts");
  assert.equal(existsSync(path.join(root, "old.txt")), true);
});

test("a git repository without a remote is applied to its working tree, and PR approval says why it cannot run", async (t) => {
  const { root, workspace, delivery, id } = await setup(t, (folder) => {
    for (const args of [["init", "-b", "main"], ["add", "-A"], ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-m", "start"]]) {
      execFileSync("git", args, { cwd: folder });
    }
  });
  await agentEdits(workspace);
  await assert.rejects(delivery.approve(id, "work"), (error) => error.status === 409);
  await delivery.applyToFolder(id);
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "two");
  assert.equal(existsSync(path.join(root, "old.txt")), false);
  assert.match(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), /a\.txt/, "changes stay uncommitted for the user");
});
