"use strict";

const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { artifactPath } = require("./graph-definition");
const { problem } = require("./state");

const limit = 32 * 1024 * 1024;

function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

async function artifactDigest(workspace, relative, signal) {
  if (!workspace) throw problem(409, "No workflow workspace for artifact");
  const parts = artifactPath(relative).split("/");
  const root = await fs.realpath(workspace);
  let file = root;
  for (const part of parts) {
    file = path.join(file, part);
    if ((await fs.lstat(file)).isSymbolicLink()) throw problem(409, "Workflow artifact cannot follow a symbolic link");
  }
  const resolved = await fs.realpath(file);
  const offset = path.relative(root, resolved);
  if (path.isAbsolute(offset) || offset === ".." || offset.startsWith(".." + path.sep)) {
    throw problem(409, "Workflow artifact is outside the workspace");
  }
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(limit)) {
      throw problem(409, "Workflow artifact must be a regular file of at most 32 MiB");
    }
    const verified = await fs.lstat(file, { bigint: true });
    if (!sameFile(info, verified) || await fs.realpath(file) !== resolved) {
      throw problem(409, "Workflow artifact changed while being opened");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let length = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > limit) throw problem(409, "Workflow artifact grew past 32 MiB");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (BigInt(length) !== info.size || !sameFile(info, await handle.stat({ bigint: true }))) {
      throw problem(409, "Workflow artifact changed while being read");
    }
    return { path: relative, byteLength: length, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function validateArtifacts(workspace, artifacts, signal) {
  for (const artifact of artifacts) {
    let actual;
    try { actual = await artifactDigest(workspace, artifact.path, signal); } catch (error) {
      signal?.throwIfAborted();
      throw problem(409, "Workflow artifact is unavailable: " + artifact.path);
    }
    if (actual.sha256 !== artifact.sha256) throw problem(409, "Workflow artifact changed: " + artifact.path);
  }
}

async function verifyInputs(workspace, node, results, signal) {
  const inputs = node.inputs.map((input) => {
    const source = results.get(input.source);
    const artifact = source?.status === "succeeded" && source.artifacts?.find(({ name }) => name === input.artifact);
    if (!artifact) throw problem(409, "Required workflow artifact was not produced: " + input.name);
    return { ...artifact, input: input.name, producer: input.source };
  });
  await validateArtifacts(workspace, inputs, signal);
  return inputs;
}

async function collectOutputs(workspace, node, signal) {
  const artifacts = [];
  for (const output of node.outputs) {
    try {
      artifacts.push({ name: output.name, ...await artifactDigest(workspace, output.path, signal) });
    } catch (error) {
      signal?.throwIfAborted();
      if (error.status) throw error;
      throw problem(409, "Required workflow output was not produced: " + output.path);
    }
  }
  return artifacts;
}

module.exports = { artifactDigest, validateArtifacts, verifyInputs, collectOutputs };
