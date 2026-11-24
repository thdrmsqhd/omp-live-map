"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const profile = "omp-live-map";

function consoleOAuth() {
  const command = process.platform === "win32" ? "ant.exe" : "ant";
  const directories = (process.env.PATH ?? "").split(path.delimiter)
    .map((directory) => directory.replace(/^"|"$/g, ""))
    .filter((directory) => path.isAbsolute(directory));
  const binary = [path.join(__dirname, "../../vendor/ant"), ...directories]
    .map((directory) => path.join(directory, command))
    .find((file) => {
      try { return fs.statSync(file, { throwIfNoEntry: false })?.isFile(); } catch { return false; }
    });
  if (!binary) return null;

  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^anthropic_(?!config_dir$)|^claude_code_oauth_token$|^omp_map_engineering_token$/i.test(name)) delete env[name];
  }
  const options = { env, windowsHide: true, maxBuffer: 16384 };
  async function accessToken(signal) {
    try {
      const { stdout } = await run(binary, ["auth", "print-credentials", "--profile", profile, "--access-token"], {
        ...options, signal, timeout: 15000,
      });
      const token = stdout.trim();
      if (!/^sk-ant-oat[\w.-]+$/.test(token)) throw new Error("Unexpected credential");
      return token;
    } catch {
      signal?.throwIfAborted();
      throw new Error("Claude Console 로그인 상태를 확인해 주세요.");
    }
  }
  return {
    accessToken,
    async login(signal) {
      await run(binary, ["auth", "login", "--profile", profile], { ...options, signal, timeout: 310000 });
    },
  };
}

module.exports = { consoleOAuth };
