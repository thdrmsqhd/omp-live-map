"use strict";

const transitions = {
  queued: ["running", "cancelled", "blocked", "limit_exceeded"],
  running: ["paused", "interrupted", "succeeded", "failed", "cancelled", "limit_exceeded"],
  paused: ["running", "cancelled", "limit_exceeded"],
  interrupted: ["cancelled"],
};

// Workflow 실행(workflow_run)의 상태 전이. 현재 코드가 쓰는 전이를 모두 적었다(workflow-engine.js, workflow-runs.js).
// 이 표에 없는 전이는 아직 거부하지 않고 workflow.transition.unexpected 이벤트로 남긴다(관찰 후 거부로 바꾼다).
const workflowTransitions = Object.freeze({
  queued: ["running", "cancelled", "limit_exceeded", "interrupted", "failed"],
  running: ["waiting_approval", "paused", "succeeded", "failed", "cancelled", "limit_exceeded", "interrupted"],
  waiting_approval: ["queued", "cancelled"],
  paused: ["running", "cancelled", "limit_exceeded", "interrupted", "failed"],
  interrupted: ["running", "cancelled", "limit_exceeded", "interrupted", "failed"],
  failed: ["queued"],
});
const workflowTransitionAllowed = (from, to) => Boolean(workflowTransitions[from]?.includes(to));

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function checkTransition(from, to) {
  if (!transitions[from]?.includes(to)) throw problem(409, `Invalid run transition: ${from} → ${to}`);
}

function maskSecrets(value) {
  return String(value ?? "")
    .replace(/\b(authorization|api[-_ ]?key|password|secret|token)\s*[:=]\s*(?:Bearer\s+)?[^\s,;"'}]+/gi, "$1=[redacted]")
    .replace(/\b(?:sk-(?:ant-)?|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/g, "[redacted]");
}

function redact(value, secrets = []) {
  const hidden = secrets.filter((item) => typeof item === "string" && item.length > 0);
  return maskSecrets(value)
    .split("\n").slice(-100).map((line) => hidden.reduce((result, secret) => result.split(secret).join("[redacted]"), line))
    .join("\n").slice(-8000);
}

module.exports = { checkTransition, problem, redact, maskSecrets, workflowTransitions, workflowTransitionAllowed };
