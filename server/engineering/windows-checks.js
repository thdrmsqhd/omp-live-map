"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { commandRunner } = require("./command-runner");
const { problem } = require("./state");

function createWindowsChecks({ launcher, worktreeRoot, programs, allowlist }) {
  if (process.platform !== "win32") throw problem(409, "Windows command isolation is unavailable");
  if (!path.isAbsolute(launcher) || !path.isAbsolute(worktreeRoot)) throw problem(409, "Absolute isolation paths are required");
  const treeRoot = fs.realpathSync(worktreeRoot);
  const backend = {
    enforced: fs.statSync(launcher).isFile(),
    launch(command, args, options) {
      const executable = programs.get(command);
      const requested = path.resolve(options.cwd);
      const actual = fs.realpathSync(requested);
      if (!executable || !path.isAbsolute(executable) || path.dirname(actual) !== treeRoot ||
          fs.lstatSync(requested).isSymbolicLink() || actual.toLowerCase() !== requested.toLowerCase()) {
        throw problem(409, "Command has no trusted binary or the worktree path is invalid");
      }
      const child = spawn(launcher, [actual, executable, ...args], { ...options, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.on("error", () => {});
      child.stdin.end();
      return child;
    },
    terminate(child) { child.kill(); },
  };
  const runner = commandRunner(backend, allowlist.filter(({ command }) => programs.has(command)));
  return {
    ...runner,
    async execute(check, cwd, signal) {
      const result = await runner.execute(check, cwd, signal);
      if (result.code === 125) throw problem(409, "Windows isolation refused the verification command. " + result.log);
      return result;
    },
  };
}

module.exports = { createWindowsChecks };
