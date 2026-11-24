"use strict";

const transitions = {
  queued: ["running", "cancelled", "blocked", "limit_exceeded"],
  running: ["paused", "interrupted", "succeeded", "failed", "cancelled", "limit_exceeded"],
  paused: ["running", "cancelled", "limit_exceeded"],
  interrupted: ["cancelled"],
};

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function checkTransition(from, to) {
  if (!transitions[from]?.includes(to)) throw problem(409, `Invalid run transition: ${from} → ${to}`);
}

function redact(value, secrets = []) {
  const hidden = secrets.filter((item) => typeof item === "string" && item.length > 0);
  return String(value ?? "")
    .replace(/\b(authorization|api[-_ ]?key|password|secret|token)\s*[:=]\s*(?:Bearer\s+)?[^\s,;"'}]+/gi, "$1=[redacted]")
    .replace(/\b(?:sk-(?:ant-)?|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .split("\n").slice(-100).map((line) => hidden.reduce((result, secret) => result.split(secret).join("[redacted]"), line))
    .join("\n").slice(-8000);
}

module.exports = { checkTransition, problem, redact };
