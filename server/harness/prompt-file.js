"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withPromptFile(content, launch) {
  if (!content) return launch();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-session-prompt-"));
  const file = path.join(directory, "prompt.md");
  const cleanup = () => fs.rm(directory, { recursive: true, force: true }, () => {});
  try {
    fs.writeFileSync(file, content, { mode: 0o600 });
    const child = launch(file);
    child.once("close", cleanup);
    return child;
  } catch (error) {
    cleanup();
    throw error;
  }
}

module.exports = { withPromptFile };
