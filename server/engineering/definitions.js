"use strict";

const { harnessAssets } = require("./harness-assets");
const { problem } = require("./state");

function string(value, label, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw problem(400, `Invalid ${label}`);
  }
  return value.trim();
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw problem(400, `Invalid ${label}`);
  return value;
}

function definition(kind, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw problem(400, "Definition payload is required");
  const name = string(body.name, "name");
  if (kind === "model") {
    return { name, provider: string(body.provider, "provider"), model: string(body.model, "model"),
      reasoning: body.reasoning ? string(body.reasoning, "reasoning") : "" };
  }
  if (kind === "harness") {
    if (!["omp", "claude"].includes(body.adapter)) throw problem(400, "Unsupported harness");
    return { name, adapter: body.adapter, model: string(body.model, "model definition id"),
      role: string(body.role, "role"), instructions: body.instructions ? string(body.instructions, "instructions", 12000) : "",
      permission: "workspace-only", assets: harnessAssets(body.assets) };
  }
  if (kind !== "loop") throw problem(400, "Unsupported definition kind");
  if (!Array.isArray(body.checks) || !body.checks.length || body.checks.length > 10) throw problem(400, "Supply 1–10 checks");
  return {
    name, harness: string(body.harness, "harness definition id"),
    attempts: integer(body.attempts, "attempt count", 1, 8),
    timeoutMs: integer(body.timeoutMs, "timeoutMs", 100, 3600000),
    budgetCents: integer(body.budgetCents, "budgetCents", 0, 100000),
    checks: body.checks.map((check) => {
      if (!check || !Array.isArray(check.args) || check.args.length > 24) throw problem(400, "Invalid check arguments");
      return {
        command: string(check.command, "check command"),
        args: check.args.map((arg) => {
          if (typeof arg !== "string" || arg.length > 1000 || arg.includes("\0")) throw problem(400, "Invalid check argument");
          return arg;
        }),
        code: integer(check.code ?? 0, "exit code", 0, 255),
      };
    }),
  };
}

module.exports = { string, integer, definition };
