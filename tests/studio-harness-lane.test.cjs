"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const CONTRACT_LABELS = ["입력", "산출물", "판단 기준", "인계", "중단 조건", "산출물 스키마 ID"];

function element(tag) {
  const node = {
    tag,
    className: "",
    dataset: {},
    attrs: {},
    children: [],
    open: false,
    value: "",
    title: "",
    hidden: false,
    disabled: false,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener() {},
    append(...nodes) {
      for (const child of nodes) if (child != null && child !== false) this.children.push(child);
    },
  };
  Object.defineProperty(node, "textContent", {
    get() {
      return this.children.map((child) => typeof child === "string" ? child : child.textContent || "").join("");
    },
  });
  return node;
}

function loadStudioNodes() {
  const sandbox = {
    console,
    document: { createElement: element },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "server/engineering/harness-kinds.js"), "utf8"), context);
  const source = fs.readFileSync(path.join(root, "ui/js/studio-nodes.js"), "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "")
    + "\nglobalThis.__api = { socketsOf, harnessTypeOf, harnessContractDetails, isEvaluationRole, isEvaluationHarness, evaluationFlowBlock, socketDragAllowed, EXTERNAL_LANE_X, EXTERNAL_LANE_LABEL };";
  vm.runInContext(source, context);
  return sandbox.__api;
}

const api = loadStudioNodes();
const evaluation = { kind: "harness", draft: { role: "평가 하네스" } };
const namedEvaluation = { kind: "harness", draft: { role: "평가 하네스 · 품질" } };
const search = { kind: "harness", draft: { role: "검색 하네스" } };
const step = { kind: "step", data: { type: "agent" } };
const loop = { kind: "loop", draft: { name: "루프" } };

test("harness cards expose the catalog contract instead of only a collapsed inspector", () => {
  const visible = api.harnessContractDetails("검색 하네스", { visible: true });
  assert.equal(visible.tag, "section");
  assert.equal(visible.className, "studio-contract");
  assert.equal(visible.children.some((child) => child.tag === "details"), false);
  for (const label of CONTRACT_LABELS) assert.match(visible.textContent, new RegExp(label));
  assert.match(visible.textContent, /evidence_list/);
  assert.match(visible.textContent, /정보를 다루는 하네스/);

  const evaluationContract = api.harnessContractDetails("평가 하네스 · 품질", { visible: true });
  assert.match(evaluationContract.textContent, /evaluation_report/);
  assert.match(evaluationContract.textContent, /판단하는 하네스/);
  for (const label of CONTRACT_LABELS) assert.match(evaluationContract.textContent, new RegExp(label));

  const inspector = api.harnessContractDetails("검색 하네스");
  assert.equal(inspector.tag, "details");
  assert.equal(inspector.open, false);
  assert.equal(api.harnessContractDetails("없는 역할"), null);
});

test("evaluation harnesses stay outside the execution flow while definition sockets remain", () => {
  assert.equal(api.isEvaluationRole("평가 하네스"), true);
  assert.equal(api.isEvaluationRole("평가 하네스 · 품질"), true);
  assert.equal(api.isEvaluationHarness(evaluation), true);
  assert.equal(api.isEvaluationHarness(namedEvaluation), true);
  assert.equal(api.isEvaluationHarness(search), false);
  assert.equal(api.harnessTypeOf("평가 하네스").id, "evaluation");

  const outputs = api.socketsOf(evaluation).outputs;
  assert.equal(outputs.some((socket) => socket.type === "flow"), false);
  assert.equal(outputs.every((socket) => socket.execution === false), true);
  assert.equal(api.socketsOf(evaluation).inputs.some((socket) => socket.type === "model"), true);
  assert.equal(api.socketDragAllowed(evaluation, "out", outputs[0]), false);
  assert.equal(api.socketDragAllowed(evaluation, "in", api.socketsOf(evaluation).inputs[0]), true);

  const normal = api.socketsOf(search);
  assert.deepEqual(JSON.parse(JSON.stringify(normal.outputs)), [{ slot: "harness", type: "harness", label: "하네스" }]);
  assert.equal(api.socketDragAllowed(search, "out", normal.outputs[0]), true);
  assert.equal(normal.outputs.some((socket) => socket.type === "flow"), false);

  assert.match(api.evaluationFlowBlock(evaluation, step, "harness"), /실행 흐름 밖/);
  assert.match(api.evaluationFlowBlock(namedEvaluation, step, "flow"), /실행 흐름 밖/);
  assert.equal(api.evaluationFlowBlock(evaluation, loop, "harness"), "");
  assert.equal(api.evaluationFlowBlock(search, step, "harness"), "");
  assert.ok(api.EXTERNAL_LANE_X < 0);
  assert.equal(api.EXTERNAL_LANE_LABEL, "독립 평가 · 실행 흐름 밖");
});

test("studio canvas wires the visible contract and external lane without changing other harness sockets", () => {
  // 노드 캔버스는 studio.js 와 그 모듈(studio-*.js)로 나뉘어 있다.
  const studio = ["studio.js", "studio-layout.js", "studio-drag.js", "studio-menu.js", "studio-persist.js"]
    .map((file) => fs.readFileSync(path.join(root, "ui/js", file), "utf8")).join("\n");
  const css = fs.readFileSync(path.join(root, "ui/css/studio.css"), "utf8");
  assert.match(studio, /harnessContractDetails\(node\.draft\.role, \{ visible: true \}\)/);
  assert.match(studio, /EXTERNAL_LANE_LABEL/);
  assert.match(studio, /evaluationFlowBlock\(source, target, slot\)/);
  assert.match(studio, /isEvaluationHarness\(node\) \? EXTERNAL_LANE_X/);
  assert.match(studio, /socketDragAllowed\(node, direction, spec\)/);
  assert.match(css, /\.studio-contract-list/);
  assert.match(css, /\.studio-external-label/);
  assert.match(css, /\.studio-node\.is-external/);
  assert.match(css, /data-link-origin="evaluation"/);
});
