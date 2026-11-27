"use strict";

// 실행 창은 고른 하네스·Loop 가 무엇을 하는지 한 줄로 보여 준다. 하네스는 역할과 모델, Loop 는 실행할 하네스·최대 시도·검증 명령이다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../ui/js/view/workflow-launch.js"), "utf8").replace(/\r\n/g, "\n");
const pick = (start) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, start);
  return source.slice(at, source.indexOf("\n}\n", at) + 3);
};
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(pick("function workflowRoleSummary(") + "\nthis.workflowRoleSummary = workflowRoleSummary;", sandbox);
const summary = sandbox.workflowRoleSummary;

const definitions = [
  { id: "m1", kind: "model", name: "기본 · Claude Sonnet 5.5", payload: { model: "claude-sonnet-5-5" } },
  { id: "h1", kind: "harness", name: "기본 · Node 개발", payload: { role: "개발", model: "m1" } },
  { id: "h2", kind: "harness", name: "빈 하네스", payload: { role: "리뷰", model: "" } },
  { id: "l1", kind: "loop", name: "기능 개발 · Node", payload: { harness: "h1", attempts: 3, checks: [{ command: "npm", args: ["test"], code: 0 }] } },
  { id: "l2", kind: "loop", name: "검증 없는 루프", payload: { harness: "gone", attempts: 1, checks: [] } },
];

test("a harness reads as its role and the model it thinks with", () => {
  assert.equal(summary("h1", definitions), "역할 개발 · 모델 기본 · Claude Sonnet 5.5");
  assert.equal(summary("h2", definitions), "역할 리뷰 · 모델 연결 안 됨");
});

test("a loop reads as the harness it repeats, how many tries, and the check that ends it", () => {
  assert.equal(summary("l1", definitions), "하네스 기본 · Node 개발 · 최대 3회 · 검증 npm test");
  assert.equal(summary("l2", definitions), "하네스 연결 안 됨 · 최대 1회 · 검증 명령 없음");
});

test("nothing chosen shows nothing", () => {
  assert.equal(summary("", definitions), "");
  assert.equal(summary("missing", definitions), "");
});

test("a saved workflow lists which harness or loop each step uses", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext([pick("function workflowRoleSummary("), pick("function workflowStepSummaries(")].join("\n")
    + "\nthis.workflowStepSummaries = workflowStepSummaries;", sandbox);
  const payload = { nodes: [
    { id: "start", type: "start", label: "Start" },
    { id: "plan", type: "agent", label: "요구사항 및 계획", definition: "h1" },
    { id: "approve", type: "approval", label: "설계 승인" },
    { id: "work", type: "loop", label: "작업 및 검증", definition: "l1" },
    { id: "p", type: "profile", profileId: "x", profileVersion: 1 },
    { id: "review", type: "agent", label: "코드 리뷰" },
    { id: "lost", type: "agent", label: "빈 단계", definition: "gone" },
  ], edges: [{ from: "p", to: "review", port: "profile" }] };
  assert.deepEqual([...sandbox.workflowStepSummaries(payload, definitions)], [
    "요구사항 및 계획 → 하네스 기본 · Node 개발 (역할 개발 · 모델 기본 · Claude Sonnet 5.5)",
    "작업 및 검증 → 루프 기능 개발 · Node (하네스 기본 · Node 개발 · 최대 3회 · 검증 npm test)",
    "코드 리뷰 → 에이전트 프로필",
    "빈 단계 → 연결 안 됨",
  ]);
});
