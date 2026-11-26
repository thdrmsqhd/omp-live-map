"use strict";

const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { problem } = require("./state");

// Exact project-relative names only; no discovery, directory recursion, or ancestor search.
const names = new Map([
  ["README.md", "purpose"], ["README.txt", "purpose"],
  ["PROJECT.md", "purpose"], ["PROJECT.txt", "purpose"],
  ["PROGRESS.md", "progress"], ["PROGRESS.txt", "progress"], ["STATUS.md", "progress"], ["STATUS.txt", "progress"],
  ["DECISIONS.md", "decisions"], ["DECISIONS.txt", "decisions"],
  ["docs/README.md", "purpose"], ["docs/PROJECT.md", "purpose"],
  ["docs/PROGRESS.md", "progress"], ["docs/STATUS.md", "progress"], ["docs/DECISIONS.md", "decisions"],
  ["docs/harness-editor-progress.md", "progress"], ["docs/workflow-canvas-tasks.md", ""],
  ["docs/guide/engineering.md", ""],
]);
const maxBytes = 32 * 1024;
const pattern = {
  purpose: /\b(?:purpose|objectives?|goals?|overview)\b|목표|목적|개요|한눈에 보기/i,
  progress: /\b(?:progress|status|milestones?|changelog|tasks?)\b|진행|현황|작업 목록|^작업$/i,
  decisions: /\b(?:decisions?|ADR|trade-offs?|accepted)\b|결정|채택|^안전장치$/i,
};
const samePath = (left, right) => path.relative(left, right) === "";
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

async function inspect(root, name) {
  const start = await fs.lstat(root);
  if (!start.isDirectory() || !samePath(root, await fs.realpath(root))) return null;
  const parts = name.split("/");
  const file = path.join(root, ...parts);
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative.startsWith(".." + path.sep)) return null;
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    if (!(await fs.lstat(parent)).isDirectory()) return null;
  }
  const entry = await fs.lstat(file, { bigint: true });
  if (!entry.isFile() || entry.nlink !== 1n || !samePath(file, await fs.realpath(file))) return null;
  return { file, entry };
}

async function read(root, name) {
  try {
    const before = await inspect(root, name);
    if (!before) return null;
    const file = await fs.open(before.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const opened = await file.stat({ bigint: true });
      const after = await inspect(root, name);
      if (!opened.isFile() || opened.nlink !== 1n || !after || !sameFile(opened, before.entry) || !sameFile(opened, after.entry)) return null;
      const data = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const truncated = offset > maxBytes;
      const content = data.subarray(0, Math.min(offset, maxBytes));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(content, { stream: truncated });
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || !text.trim()) return null;
      const version = createHash("sha256").update(content).update(String(truncated)).digest("hex");
      const title = text.match(/^#\s+(.+)$/m)?.[1].trim().slice(0, 140) || name;
      return { id: name, title, version, truncated, text };
    } finally { await file.close(); }
  } catch {
    // Missing, unreadable, and unsafe files are indistinguishable to the renderer.
    return null;
  }
}

function firstExcerpts({ id, text }) {
  let heading = "", headingKind = "", fence = "", comment = false;
  let summary = [], sourceLine = 0, purposeUsed = false;
  const entries = [];
  function flush() {
    if (!summary.length) return;
    const kind = headingKind || names.get(id);
    const excerpt = summary.join(" ").replace(/\s+/g, " ").trim();
    if (kind && excerpt.length >= 12 && !(kind === "purpose" && !headingKind && purposeUsed)) {
      const snippet = excerpt.length > 260 ? excerpt.slice(0, 257).trimEnd() + "…" : excerpt;
      entries.push({ kind, source: id, heading, line: sourceLine, text: snippet });
      if (kind === "purpose") purposeUsed = true;
    }
    summary = [];
  }
  const lines = text.split(/\r?\n/);
  const tableDivider = /^\|?(?:\s*:?-{2,}:?\s*\|)+\s*$/;
  for (const [index, raw] of lines.entries()) {
    let line = raw.trim();
    const marker = line.match(/^(`{3,}|~{3,})/)?.[1];
    if (fence) { if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = ""; continue; }
    if (marker) { flush(); fence = marker; continue; }
    if (comment) { if (!line.includes("-->")) continue; line = line.split("-->").at(-1).trim(); comment = false; }
    line = line.replace(/<!--.*?-->/g, "");
    if (line.includes("<!--")) { line = line.split("<!--")[0].trim(); comment = true; }
    const title = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (title) {
      flush(); heading = title.slice(0, 140);
      headingKind = Object.keys(pattern).find((kind) => pattern[kind].test(title)) ?? "";
      continue;
    }
    const taskRow = /^\|\s*\[[ xX]\]\s*\|/.test(line);
    const decisionRow = (headingKind || names.get(id)) === "decisions" && line.startsWith("|") &&
      !tableDivider.test(line) && !tableDivider.test(lines[index + 1]?.trim() ?? "");
    if (taskRow || decisionRow) line = line.replace(/^\|\s*|\s*\|$/g, "").replace(/\s*\|\s*/g, " · ");
    if (!line || line.startsWith("|") || line.startsWith("![") || /^(?:---+|===+)$/.test(line)) { flush(); continue; }
    if (/^([-*+] |\d+\. )/.test(line) || taskRow || decisionRow) flush();
    line = line.replace(/^(?:[-*+]\s+|\d+\.\s+|>\s*)/, "").replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").trim();
    if (!line) continue;
    if (!summary.length) sourceLine = index + 1;
    summary.push(line.slice(0, 300));
  }
  flush();
  return entries;
}

async function projectContext(project, source = null) {
  const root = project.root;
  if (source !== null) {
    if (!names.has(source)) throw problem(404, "Project document not found");
    const doc = await read(root, source);
    if (!doc) throw problem(404, "Project document not found");
    return doc;
  }
  const docs = (await Promise.all([...names.keys()].map((name) => read(root, name)))).filter(Boolean);
  const entries = docs.flatMap(firstExcerpts);
  const summary = Object.fromEntries(Object.keys(pattern).map((kind) => {
    const candidates = entries.filter((item) => item.kind === kind);
    if (kind === "progress") {
      const rank = (item) => /^\[ \]/.test(item.text) ? 0 : /^\[x\] /i.test(item.text) ? 1 : /^(?:기준 원격 커밋|base commit)/i.test(item.text) ? 3 : 2;
      candidates.sort((a, b) => rank(a) - rank(b) || b.line - a.line);
    }
    const distinct = new Map();
    for (const item of candidates) if (!distinct.has(item.source)) distinct.set(item.source, item);
    const ordered = [...distinct.values()];
    return [kind, [...ordered, ...candidates.filter((item) => !ordered.includes(item))].slice(0, 3)];
  }));
  return { project: { id: project.id, name: project.name }, summary,
    sources: docs.map(({ id, title, version, truncated }) => ({ id, title, version, truncated })) };
}

module.exports = { projectContext };
