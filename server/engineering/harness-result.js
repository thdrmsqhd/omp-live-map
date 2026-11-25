"use strict";

const { artifactPath } = require("./artifact-path");
const { artifactText } = require("./workflow-artifact");
const { problem } = require("./state");

function resultContract(value) {
  if (value === undefined) return undefined;
  if (!value || !["object", "array"].includes(value.shape) || !Array.isArray(value.fields) ||
      value.fields.length < 1 || value.fields.length > 16 ||
      value.fields.some((field) => typeof field !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field)) ||
      new Set(value.fields).size !== value.fields.length) throw problem(400, "Invalid harness result fields");
  return { shape: value.shape, fields: value.fields, path: artifactPath(value.path) };
}

function resultInstruction(result) {
  if (!result) return "";
  const kind = result.shape === "object" ? "a JSON object" : "a JSON array of objects (empty if there are no findings)";
  return "Write " + kind + " to " + result.path + ". Required non-empty fields: " + result.fields.join(", ") + ".";
}

function records(value, shape) {
  const isObject = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
  if (shape === "object" && isObject(value)) return [value];
  if (shape === "array" && Array.isArray(value) && value.every(isObject)) return value;
  return null;
}

async function verifyResult(contract, workspace, signal) {
  if (!contract) return null;
  let file;
  let value;
  try {
    file = await artifactText(workspace, { path: contract.path }, 32 * 1024, signal);
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  } catch (error) {
    signal?.throwIfAborted();
    return { path: contract.path, passed: false,
      errors: [file ? "Result is not valid UTF-8 JSON" : "Result file is missing, invalid or too large"] };
  }
  const rows = records(value, contract.shape);
  const errors = rows === null ? ["Result has the wrong JSON shape"] : [];
  for (const [index, row] of (rows ?? []).entries()) {
    for (const field of contract.fields) {
      const value = row[field];
      if (!Object.hasOwn(row, field) || value === null || typeof value === "string" && !value.trim() ||
          Array.isArray(value) && !value.length) errors.push("Item " + (index + 1) + ": " + field + " is missing or empty");
      if (errors.length >= 50) break;
    }
    if (errors.length >= 50) break;
  }
  return { path: contract.path, passed: !errors.length, errors, sha256: file.sha256, value };
}

module.exports = { resultContract, resultInstruction, verifyResult };
