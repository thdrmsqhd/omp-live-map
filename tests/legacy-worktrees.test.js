"use strict";

// 예전 격리 작업 폴더(<engineering data>/worktrees/<uuid>) 실행: 오류 대신 이유를 알리고, 남은 worktree 는 한 번 정리한다.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { cleanLegacyWorktrees, legacyWorkspace, LEGACY_MESSAGE } = require("../server/engineering/legacy-worktrees");
const { runFolder } = require("../server/engineering/work-folder");

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });

test("legacy workspace paths are recognised only for worktrees/<uuid>", () => {
  assert.equal(legacyWorkspace("C:/data/engineering/worktrees/0f8fad5b-d9cb-469f-a165-70867728950e"), true);
  assert.equal(legacyWorkspace("/home/u/eng/worktrees/0F8FAD5B-D9CB-469F-A165-70867728950E/"), true);
  assert.equal(legacyWorkspace("C:/data/engineering/worktrees/not-a-uuid"), false);
  assert.equal(legacyWorkspace("C:/work/project"), false);
  assert.equal(legacyWorkspace(null), false);
});

test("runFolder answers old runs with the Korean legacy message", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "omp-legacy-p-"));
  try {
    const catalog = { project: () => ({ root: project }) };
    const run = { project: "p", workspace: path.join(os.tmpdir(), "eng", "worktrees", "0f8fad5b-d9cb-469f-a165-70867728950e") };
    await assert.rejects(runFolder(catalog, run), (error) => error.status === 409 && error.legacy === true && error.message === LEGACY_MESSAGE);
    assert.equal(await runFolder(catalog, { project: "p", workspace: project }), fs.realpathSync(project));
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test("one-time cleanup removes only worktrees of registered projects and logs them", { timeout: 30000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "omp-legacy-"));
  try {
    const repo = path.join(base, "repo"), other = path.join(base, "other"), data = path.join(base, "data");
    const trees = path.join(data, "worktrees");
    for (const dir of [repo, other]) {
      fs.mkdirSync(dir);
      git(dir, "init", "-q");
      git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    }
    fs.mkdirSync(trees, { recursive: true });
    const mine = path.join(trees, "11111111-2222-4333-8444-555555555555");
    const foreign = path.join(trees, "66666666-7777-4888-9999-000000000000");
    const plain = path.join(trees, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    const named = path.join(trees, "keep-me");
    git(repo, "worktree", "add", "-q", "--detach", mine);
    git(other, "worktree", "add", "-q", "--detach", foreign);
    fs.mkdirSync(plain);
    fs.mkdirSync(named);
    fs.writeFileSync(path.join(mine, "dirty.txt"), "uncommitted");
    const lines = [];
    const result = await cleanLegacyWorktrees({ directory: data, projects: [{ root: repo }, { root: path.join(base, "missing") }], log: (l) => lines.push(l) });
    assert.deepEqual(result.removed, [mine]);
    assert.equal(fs.existsSync(mine), false, "the registered project's worktree is removed even when dirty");
    assert.equal(fs.existsSync(foreign) && fs.existsSync(plain) && fs.existsSync(named), true, "everything else stays");
    assert.doesNotMatch(git(repo, "worktree", "list"), /11111111/, "git worktree prune ran on the project repo");
    assert.match(git(other, "worktree", "list"), /66666666/);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /이전 격리 작업 폴더를 지웠습니다/);
    const again = await cleanLegacyWorktrees({ directory: data, projects: [{ root: other }] });
    assert.equal(again.skipped, true, "runs once (marker file)");
    assert.equal(fs.existsSync(foreign), true);
  } finally { fs.rmSync(base, { recursive: true, force: true, maxRetries: 4 }); }
});
