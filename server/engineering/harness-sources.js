"use strict";

const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { git } = require("./catalog");
const { artifactText } = require("./workflow-artifact");
const { problem } = require("./state");
const shadow = require("./shadow-repo");

const launch = promisify(execFile);
const maxBytes = 16 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function text(bytes, label) {
  if (bytes.byteLength > maxBytes || bytes.includes(0)) throw problem(409, "Harness source must be a small text file: " + label);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw problem(409, "Harness source is not UTF-8: " + label); }
}

async function gitSource(root, commit, file, signal) {
  try {
    signal?.throwIfAborted();
    const entry = await git(root, ["--literal-pathspecs", "ls-tree", "-z", commit, "--", file]);
    const match = /^100(?:644|755) blob ([a-f0-9]{40,64})\t/.exec(entry);
    if (!match || entry.slice(match[0].length) !== file + "\0") throw new Error();
    const { stdout } = await launch("git", shadow.gitArgs(root, ["cat-file", "blob", match[1]]), {
      cwd: root, encoding: "buffer", timeout: 12000, windowsHide: true, maxBuffer: maxBytes, signal,
    });
    return { kind: "repository", path: file, commit, sha256: digest(stdout), text: text(stdout, file) };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.status) throw error;
    throw problem(409, "Harness source missing, oversized or not a tracked regular file: " + file);
  }
}

async function resolveSources(harness, project, workspace, inputs = [], signal, { trial = false } = {}) {
  const files = harness.assets?.files ?? [];
  const named = harness.assets?.inputs ?? [];
  const root = workspace ?? project.root;
  const revision = workspace ? "HEAD" : "refs/heads/" + project.branch;
  const commit = files.length ? await git(root, ["rev-parse", "--verify", revision + "^{commit}"]) : null;
  const sources = [];
  for (const file of files) sources.push(await gitSource(root, commit, file, signal));
  if (workspace && !trial) for (const name of named) {
    const input = inputs.find(({ input }) => input === name);
    if (!input) throw problem(409, "Harness workflow input was not provided: " + name);
    const value = await artifactText(workspace, input, maxBytes, signal);
    sources.push({ kind: "workflow", path: value.path, input: name, sha256: value.sha256, text: text(value.bytes, name) });
  }
  return sources;
}

function withSources(harness, resolvedSources) {
  return { ...harness, resolvedSources };
}

function sourceReferences(sources) {
  return sources.map(({ text, ...reference }) => reference);
}

module.exports = { resolveSources, withSources, sourceReferences };
