"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { git } = require("./catalog");
const { problem } = require("./state");
const shadow = require("./shadow-repo");

function worktrees(directory, gitCommand = git) {
  return {
    async create(project, run, source, fixedCommit) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const workspace = path.join(directory, run.id);
      const branch = "refs/heads/" + project.branch;
      // git 이 아닌 폴더는 실행마다 지금 파일을 스냅숏해 worktree 에 넣는다.
      if (!fixedCommit && !source) await shadow.snapshot(project.root);
      const commit = fixedCommit ?? await gitCommand(source ?? project.root, ["rev-parse", "--verify", (source ? "HEAD" : branch) + "^{commit}"]);
      if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw problem(409, "Could not resolve the selected branch");
      await gitCommand(project.root, ["-c", "core.hooksPath=" + path.resolve(directory, ".disabled-hooks"),
        "worktree", "add", "--detach", workspace, commit]);
      return workspace;
    },
    async remove(project, workspace) {
      if (path.dirname(workspace) !== path.resolve(directory)) throw problem(400, "Invalid worktree");
      const dirty = await gitCommand(workspace, ["status", "--porcelain", "--untracked-files=all"]);
      if (dirty) throw problem(409, "Worktree has local changes");
      await gitCommand(project.root, ["worktree", "remove", "--", workspace]);
    },
  };
}

module.exports = { worktrees };
