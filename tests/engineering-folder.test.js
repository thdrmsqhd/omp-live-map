"use strict";

// 아무 폴더나 실행 때 바로 프로젝트가 된다. 실행은 그 폴더에서 바로 한다. git 이 아닌 폴더는 앱 데이터의 별도 git 디렉터리에
// 실행 전 스냅숏을 남겨 변경을 검토할 수 있게 하고, 사용자 폴더에는 .git 을 만들지 않는다.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog, git } = require("../server/engineering/catalog");
const { workFolders } = require("../server/engineering/work-folder");
const shadow = require("../server/engineering/shadow-repo");
const { withLegacyHttp } = require("./helpers/legacy-http");

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-folder-"));
  shadow.configure(path.join(directory, "shadow"));
  const db = openDatabase(path.join(directory, "db.sqlite"));
  t.after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, definitions: catalog(db) };
}

test("a plain folder becomes a project without a form and runs directly in that folder", async (t) => {
  const { directory, definitions } = await setup(t);
  const root = path.join(directory, "plain-site");
  await fs.mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
  await fs.writeFile(path.join(root, "a.txt"), "one");
  await fs.writeFile(path.join(root, "node_modules", "dep", "index.js"), "ignored");
  // build·dist 같은 이름은 프로젝트에 따라 소스다(예: build/sites-vite-plugin.ts). 폴더의 .gitignore 가 정하게 둔다.
  await fs.mkdir(path.join(root, "build"));
  await fs.writeFile(path.join(root, "build", "plugin.ts"), "export {}");

  const project = await definitions.ensureProject({ root });
  assert.equal(project.name, "plain-site", "name defaults to the folder name");
  assert.equal(project.branch, "main");
  assert.equal(existsSync(path.join(root, ".git")), false, "the user folder stays without .git");
  assert.equal((await definitions.ensureProject({ root })).id, project.id, "the same folder maps to the same project");

  // 실행 폴더는 고른 폴더 그 자체다. 실행 전 상태를 스냅숏해 실행이 바꾼 파일만 변경으로 보인다.
  await fs.writeFile(path.join(root, "a.txt"), "two");
  const workspace = await workFolders().create(project);
  assert.equal(workspace, await fs.realpath(root));
  assert.equal(await git(workspace, ["status", "--porcelain"]), "", "the folder state before the run is recorded");
  await fs.writeFile(path.join(workspace, "a.txt"), "three");
  assert.match(await git(workspace, ["status", "--porcelain"]), /a\.txt/);
  assert.doesNotMatch(await git(workspace, ["ls-files"]), /node_modules/, "dependency folders are not snapshotted");
  assert.match(await git(workspace, ["ls-files"]), /build\/plugin\.ts/, "source folders named build are kept");
  assert.equal(existsSync(path.join(root, ".git")), false);
  await assert.rejects(workFolders().create({ root: path.join(directory, "missing") }), /작업 폴더/);
});

test("a git repository keeps its own branch and a missing branch is named in the error", async (t) => {
  const { directory, definitions } = await setup(t);
  const root = path.join(directory, "repo");
  await fs.mkdir(root);
  for (const args of [["init", "-b", "main"], ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
    "commit", "--allow-empty", "-m", "start"]]) execFileSync("git", args, { cwd: root });
  const project = await definitions.ensureProject({ root });
  assert.equal(project.name, "repo");
  assert.equal(project.branch, "main");
  assert.equal(existsSync(path.join(directory, "shadow")), false, "a real repository needs no private git directory");
  await assert.rejects(definitions.saveProject({ root, name: "repo", branch: "nope" }), /nope/);
  await assert.rejects(definitions.ensureProject({ root: path.join(directory, "missing") }), /폴더/);
});

test("the ensure endpoint registers a folder on demand", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-engineering-ensure-"));
  const root = path.join(directory, "folder");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "readme.md"), "hello");
  process.env.OMP_MAP_ENGINEERING_DATA = path.join(directory, "data");
  try {
    await withLegacyHttp(t, async ({ request }) => {
      const headers = { "content-type": "application/json" };
      const first = await request("/api/engineering/projects/ensure", { method: "POST", headers, body: JSON.stringify({ root }) });
      assert.equal(first.status, 200, first.text);
      const project = JSON.parse(first.text);
      assert.equal(project.name, "folder");
      const again = await request("/api/engineering/projects/ensure", { method: "POST", headers, body: JSON.stringify({ root }) });
      assert.equal(JSON.parse(again.text).id, project.id);
    });
  } finally {
    delete process.env.OMP_MAP_ENGINEERING_DATA;
    // 라우트가 연 SQLite 는 프로세스가 끝날 때까지 열려 있어 Windows 에서는 지울 수 없다(engineering-api.test.js 와 같다).
    if (process.platform !== "win32") await fs.rm(directory, { recursive: true, force: true });
  }
});
