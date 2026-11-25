"use strict";

const { problem } = require("./state");

function artifactPath(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0")) {
    throw problem(400, "Invalid artifact path");
  }
  const file = value.trim();
  const parts = file.split("/");
  if (parts.some((part) => !part || /^\.git$/i.test(part) || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw problem(400, "Artifact paths must be portable workspace-relative paths");
  }
  return file;
}

module.exports = { artifactPath };
