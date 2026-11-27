"use strict";

// git 이 아닌 폴더를 위한 앱 데이터 안 git 디렉터리다. 사용자 폴더에는 .git 을 만들지 않는다.
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { problem } = require("./state");
const launch = promisify(execFile);

// 의존성·캐시처럼 어느 프로젝트에서도 소스가 아닌 폴더만 뺀다. build·dist 같은 이름은 소스일 수 있어 폴더의 .gitignore 에 맡긴다.
const excluded = ["node_modules/", ".venv/", "venv/", "__pycache__/", ".next/", ".wrangler/", ".turbo/", ".cache/"];
let base = null;

function configure(directory) {
  base = path.resolve(directory);
}

function candidate(root) {
  const resolved = path.resolve(root);
  const key = createHash("sha256").update(process.platform === "win32" ? resolved.toLowerCase() : resolved).digest("hex").slice(0, 32);
  return path.join(base, key + ".git");
}

function gitDirFor(root) {
  if (!base) return null;
  const dir = candidate(root);
  return existsSync(dir) ? dir : null;
}

function gitArgs(cwd, args) {
  const dir = gitDirFor(cwd);
  return dir ? ["--git-dir=" + dir, "--work-tree=" + path.resolve(cwd), ...args] : args;
}

function run(dir, root, args) {
  return launch("git", ["--git-dir=" + dir, "--work-tree=" + root, ...args],
    { cwd: root, timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

// 큰 폴더는 스냅숏이 12초를 넘을 수 있어 호출마다 120초까지 기다린다.
async function snapshot(root, { allowEmpty = false } = {}) {
  const dir = gitDirFor(root);
  if (!dir) return;
  await run(dir, root, ["add", "-A"]);
  const { stdout } = await run(dir, root, ["status", "--porcelain"]);
  if (!stdout.trim() && !allowEmpty) return;
  await run(dir, root, ["-c", "user.name=omp-live-map", "-c", "user.email=omp-live-map@localhost",
    "commit", "-q", "--no-verify", "-m", "폴더 스냅숏", ...(allowEmpty ? ["--allow-empty"] : [])]);
}

async function ensure(root) {
  if (!base) throw problem(500, "Shadow repository directory is not configured");
  const existing = gitDirFor(root);
  if (existing) return existing;
  const resolved = path.resolve(root);
  const dir = candidate(resolved);
  try {
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    await run(dir, resolved, ["init", "-q", "-b", "main"]);
    await run(dir, resolved, ["config", "core.autocrlf", "false"]);
    await run(dir, resolved, ["config", "core.safecrlf", "false"]);
    await fs.mkdir(path.join(dir, "info"), { recursive: true });
    await fs.writeFile(path.join(dir, "info", "exclude"), excluded.join("\n") + "\n");
    await snapshot(resolved, { allowEmpty: true });
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw problem(400, "폴더를 스냅숏하지 못했습니다: " + root);
  }
  return dir;
}

module.exports = { configure, gitDirFor, gitArgs, ensure, snapshot };
