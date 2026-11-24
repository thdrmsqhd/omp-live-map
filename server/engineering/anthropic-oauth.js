"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const profile = "omp-live-map";

function consoleOAuth() {
  const command = process.platform === "win32" ? "ant.exe" : "ant";
  const binary = (process.env.PATH ?? "").split(path.delimiter)
    .map((directory) => directory.replace(/^"|"$/g, ""))
    .filter((directory) => path.isAbsolute(directory))
    .map((directory) => path.join(directory, command))
    .find((file) => {
      try { return fs.statSync(file, { throwIfNoEntry: false })?.isFile(); } catch { return false; }
    });
  if (!binary) return null;

  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^anthropic_(?!config_dir$)|^claude_code_oauth_token$|^omp_map_engineering_token$/i.test(name)) delete env[name];
  }
  return async (signal) => {
    try {
      const { stdout } = await run(binary, ["auth", "print-credentials", "--profile", profile, "--access-token"], {
        env, signal, windowsHide: true, timeout: 15000, maxBuffer: 16384,
      });
      const token = stdout.trim();
      if (!/^sk-ant-oat[\w.-]+$/.test(token)) throw new Error("Unexpected credential");
      return token;
    } catch {
      signal?.throwIfAborted();
      throw new Error("Claude Console OAuth 인증을 확인해 주세요. ant auth login --profile " + profile);
    }
  };
}

module.exports = { consoleOAuth };
