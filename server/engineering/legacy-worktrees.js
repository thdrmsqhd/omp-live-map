"use strict";

// 예전 방식(격리 작업 폴더) 실행이 남긴 `<engineering data>/worktrees/<uuid>` 폴더 정리. 한 번만 돈다(표시 파일).
// 등록된 프로젝트 저장소의 git worktree 인 것만 `git worktree remove --force` + `git worktree prune` 으로 지운다.
// 맞지 않는 것(일반 폴더·다른 저장소·uuid 가 아닌 이름)은 건드리지 않는다. 지운 것은 log 로 남긴다.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARK = "worktrees-cleanup.json";
const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

// 기록된 실행 폴더가 예전 격리 폴더 모양(`…/worktrees/<uuid>`)인지.
function legacyWorkspace(workspace) {
  if (typeof workspace !== "string" || !workspace) return false;
  const parts = path.resolve(workspace).split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 && UUID.test(parts.at(-1)) && parts.at(-2).toLowerCase() === "worktrees";
}

async function real(p) { try { return await fs.realpath(p); } catch { return ""; } }

// worktree 폴더의 `.git` 파일(gitdir: <repo>/.git/worktrees/<name>) → 주 저장소의 .git 폴더.
async function commonDirOf(folder) {
  let text;
  try { text = await fs.readFile(path.join(folder, ".git"), "utf8"); } catch { return ""; }
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  if (!m) return "";
  const gitdir = path.resolve(folder, m[1].trim());
  if (path.basename(path.dirname(gitdir)).toLowerCase() !== "worktrees") return "";
  return real(path.dirname(path.dirname(gitdir)));
}

async function cleanLegacyWorktrees({ directory, projects, log = () => {}, git = "git" }) {
  const root = path.join(directory, "worktrees");
  const mark = path.join(directory, MARK);
  if (await real(mark)) return { skipped: true, removed: [] };
  let entries = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { entries = []; }
  const repos = [];
  for (const project of projects) {
    const top = await real(project.root || "");
    const dotgit = top && await real(path.join(top, ".git"));
    if (dotgit) repos.push({ top, dotgit });
  }
  const removed = [], skipped = [];
  for (const entry of entries) {
    const folder = path.join(root, entry.name);
    if (!entry.isDirectory() || !UUID.test(entry.name)) { skipped.push(folder); continue; }
    const common = await commonDirOf(folder);
    const repo = common && repos.find((r) => same(r.dotgit, common));
    if (!repo) { skipped.push(folder); continue; }
    try {
      await run(git, ["-C", repo.top, "worktree", "remove", "--force", folder], { windowsHide: true, timeout: 60000 });
      await run(git, ["-C", repo.top, "worktree", "prune"], { windowsHide: true, timeout: 60000 });
      removed.push(folder);
      log("이전 격리 작업 폴더를 지웠습니다: " + folder + " (저장소 " + repo.top + ")");
    } catch (error) {
      skipped.push(folder);
      log("이전 격리 작업 폴더를 지우지 못했습니다: " + folder + " · " + String(error.message || error).split("\n")[0]);
    }
  }
  try { await fs.rmdir(root); } catch { /* 남은 것이 있으면 둔다 */ }
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(mark, JSON.stringify({ at: new Date().toISOString(), removed, skipped }, null, 1));
  return { skipped: false, removed, left: skipped };
}

module.exports = { cleanLegacyWorktrees, legacyWorkspace, LEGACY_MESSAGE: "이전 방식(격리 작업 폴더) 실행이라 산출물을 열 수 없습니다" };
