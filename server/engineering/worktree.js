"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { git } = require("./catalog");
const { problem } = require("./state");

function worktrees(directory, gitCommand = git) {
  return {
    async create(project, run) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const workspace = path.join(directory, run.id);
      const branch = "refs/heads/" + project.branch;
      const commit = await gitCommand(project.root, ["rev-parse", "--verify", branch + "^{commit}"]);
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
