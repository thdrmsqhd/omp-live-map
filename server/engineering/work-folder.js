"use strict";

// Engineering 실행은 고른 작업 폴더(project.root)에서 바로 한다. 복사본(worktree)을 만들지 않는다.
const fs = require("node:fs/promises");
const { problem } = require("./state");
const shadow = require("./shadow-repo");
const { legacyWorkspace, LEGACY_MESSAGE } = require("./legacy-worktrees");

const same = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;

async function folderOf(project) {
  let root;
  try {
    root = await fs.realpath(project.root);
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
  } catch {
    throw problem(409, "작업 폴더를 찾을 수 없습니다: " + project.root);
  }
  return root;
}

function workFolders() {
  return {
    // git 이 아닌 폴더는 실행 전 상태를 앱 데이터의 스냅숏 저장소에 남겨, 실행이 바꾼 내용을 검토할 수 있게 한다.
    async create(project) {
      const root = await folderOf(project);
      await shadow.snapshot(root);
      return root;
    },
    // 작업 폴더는 사용자 것이므로 실행이 끝나도 지우지 않는다.
    async remove() {},
  };
}

// 기록된 실행 폴더가 지금 프로젝트의 작업 폴더와 같은지 확인한다(산출물·변경 검토·PR 은 이 폴더만 읽는다).
async function runFolder(catalog, run) {
  if (!run.workspace) throw problem(409, "이 실행에는 작업 폴더 기록이 없습니다");
  // 예전 격리 작업 폴더(<engineering data>/worktrees/<uuid>)는 지워졌다. 오류 대신 이유를 알린다.
  if (legacyWorkspace(run.workspace)) throw Object.assign(problem(409, LEGACY_MESSAGE), { legacy: true });
  const root = await folderOf(catalog.project(run.project));
  let recorded;
  try { recorded = await fs.realpath(run.workspace); } catch { recorded = ""; }
  if (!same(recorded, root)) throw problem(409, "실행 폴더가 프로젝트 작업 폴더와 다릅니다");
  return root;
}

module.exports = { workFolders, runFolder };
