"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { git } = require("./catalog");
const { artifactPath } = require("./graph-definition");
const { artifactDigest, validateArtifacts } = require("./workflow-artifact");
const { problem } = require("./state");

const fileLimit = 5000, byteLimit = 256 * 1024 * 1024;

async function files(workspace, include, signal) {
  const listed = await git(workspace, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const names = new Set([...listed.split("\0").filter(Boolean), ...include]);
  if (names.size > fileLimit) throw problem(409, "Parallel workspaces support up to 5,000 files");
  const contents = new Map();
  let bytes = 0;
  for (const relative of names) {
    signal.throwIfAborted();
    const safe = artifactPath(relative);
    try {
      const digest = await artifactDigest(workspace, safe, signal);
      bytes += digest.byteLength;
      if (bytes > byteLimit) throw problem(409, "Parallel workspace exceeds 256 MiB");
      contents.set(safe, digest);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return contents;
}

async function copyFile(source, target, relative) {
  const file = path.join(target, relative);
  for (let current = target, index = 0, parts = relative.split("/"); index < parts.length - 1; index++) {
    current = path.join(current, parts[index]);
    await fs.mkdir(current).catch((error) => { if (error.code !== "EEXIST") throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem(409, "Parallel output parent is not a regular directory");
  }
  try {
    const existing = await fs.lstat(file);
    if (!existing.isFile() || existing.nlink !== 1) throw problem(409, "Parallel output target is not a regular file");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    const original = path.join(source, relative);
    await fs.copyFile(original, temp);
    await fs.chmod(temp, (await fs.stat(original)).mode & 0o777);
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

function changed(before, after, relative) {
  const old = before.get(relative), current = after.get(relative);
  return old?.sha256 !== current?.sha256 || old?.executable !== current?.executable;
}

async function runParallel({ project, workspace, worktrees, nodes, priorArtifacts, execute, signal }) {
  const declared = nodes.flatMap((node) => node.outputs.map(({ path }) => path));
  const normalized = declared.map((item) => item.toLowerCase());
  if (new Set(normalized).size !== normalized.length ||
      normalized.some((entry) => normalized.some((other) => entry.startsWith(other + "/")))) {
    throw problem(409, "Parallel nodes declare the same output path");
  }
  const include = [...priorArtifacts, ...declared];
  const seed = await files(workspace, include, signal);
  const forks = [];
  for (const node of nodes) {
    signal.throwIfAborted();
    const fork = await worktrees.create(project, { id: randomUUID() }, workspace);
    const initial = await files(fork, [], signal);
    for (const relative of initial.keys()) {
      if (!seed.has(relative)) await fs.unlink(path.join(fork, relative));
    }
    for (const relative of seed.keys()) {
      if (changed(seed, initial, relative)) await copyFile(workspace, fork, relative);
    }
    forks.push({ node, workspace: fork });
  }

  const outcomes = await Promise.allSettled(forks.map(async (fork) => ({
    ...fork, result: await execute(fork.node, fork.workspace),
  })));
  signal.throwIfAborted();
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  const completed = outcomes.map(({ value }) => value);
  const output = [];
  for (const item of completed) {
    item.result.branchWorkspace = item.workspace;
    if (item.result.status !== "succeeded") continue;
    const branch = await files(item.workspace, include, signal);
    const allowed = new Set(item.node.outputs.map(({ path }) => path));
    if ([...new Set([...seed.keys(), ...branch.keys()])].some((relative) => changed(seed, branch, relative) && !allowed.has(relative))) {
      item.result = { ...item.result, status: "failed", interrupted: true, error: "Parallel node modified an undeclared file" };
      continue;
    }
    await validateArtifacts(item.workspace, item.result.artifacts ?? [], signal);
    for (const artifact of item.result.artifacts ?? []) output.push({ artifact, workspace: item.workspace });
  }
  // Check every target before publishing any output, so a conflict cannot mask a sibling's changes.
  for (const { artifact } of output) {
    signal.throwIfAborted();
    let existing;
    try { existing = await artifactDigest(workspace, artifact.path, signal); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing?.sha256 !== seed.get(artifact.path)?.sha256 || existing?.executable !== seed.get(artifact.path)?.executable) throw problem(409, "Parallel output conflicts with a changed workspace file");
  }
  for (const item of output) await copyFile(item.workspace, workspace, item.artifact.path);
  return completed.map(({ node, result }) => ({ node, result }));
}

module.exports = { runParallel };
