"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { problem } = require("./state");

const launch = promisify(execFile);

async function githubCli(endpoint, method = "GET", fields = {}) {
  const args = ["api", "--hostname", "github.com", "--method", method, endpoint];
  if (method === "GET") {
    for (const [key, value] of Object.entries(fields)) args.push("--raw-field", key + "=" + value);
  } else args.push("--input", "-");
  try {
    const job = launch("gh", args, {
      timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    if (method !== "GET") {
      job.child.stdin.on("error", () => {});
      job.child.stdin.end(JSON.stringify(fields));
    }
    const { stdout } = await job;
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (error) {
    if (error.code === "ENOENT") throw problem(409, "Install the GitHub CLI (gh) and sign in");
    throw problem(409, "GitHub did not confirm the request. Check gh authentication and repository permissions.");
  }
}

module.exports = { githubCli };
