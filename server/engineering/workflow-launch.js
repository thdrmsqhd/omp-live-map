"use strict";

const { createHash } = require("node:crypto");
const { integer, string } = require("./definitions");
const { buildPreset, listPresets } = require("./workflow-presets");
const { problem } = require("./state");
const { nodeDefinitions } = require("./workflow-node-executor");

function profile(catalog, project, ref, kind) {
  const entry = catalog.versionOf(string(ref?.id, kind), integer(ref?.version, "definition version", 1, Number.MAX_SAFE_INTEGER));
  if (!catalog.availableTo(entry, project) || entry.kind !== kind) throw problem(400, "Template profile has the wrong project or kind");
  return entry;
}

function makePreset(catalog, project, source) {
  const preset = listPresets().find(({ id }) => id === source.preset);
  if (!preset) throw problem(400, "Unknown workflow template");
  const refs = {};
  for (const name of ["author", "reviewer", "loop"]) {
    if (preset[name]) refs[name] = profile(catalog, project, source.refs?.[name], name === "loop" ? "loop" : "harness");
  }
  // 점검 하네스는 선택 사항이다. 고르지 않으면 설계·문서 하네스가 대신한다.
  if (preset.triage && source.refs?.triage) refs.triage = profile(catalog, project, source.refs.triage, "harness");
  const document = buildPreset(preset.id, Object.fromEntries(Object.entries(refs).map(([key, value]) => [key, value.id])));
  for (const node of document.nodes.filter(({ definition }) => definition)) {
    const ref = refs[node.type === "loop" ? "loop" : node.id === "review" ? "reviewer" : node.id === "triage" && refs.triage ? "triage" : "author"];
    node.version = ref.version;
    const harness = ref.kind === "loop" ? catalog.dependency(ref) : ref;
    const missing = (harness?.payload.assets?.inputs ?? []).filter((name) => !node.inputs?.some((input) => input.name === name));
    if (missing.length) throw problem(409, node.label + " · 필요한 입력을 연결한 저장 Workflow를 선택하세요: " + missing.join(", "));
    const format = harness?.payload.result;
    if (format && node.outputs?.length) {
      const oldPath = node.outputs[0].path;
      node.outputs[0].path = format.path;
      node.instruction = node.instruction.replace(oldPath, format.path);
    }
  }
  const key = createHash("sha256").update(JSON.stringify(document)).digest("hex").slice(0, 12);
  return { ...document, name: preset.name + " · " + key };
}

// 단독 Loop 실행을 Workflow 로 감싼다: Start → Loop 단계 → End. 템플릿 빠른 실행처럼 내용 해시로 이름 지은 사본을
// 한 번 저장하고 다시 쓰므로, 실행은 맵의 Workflow 레이어·개입 필요 함에 나타나고 같은 제어(일시정지·승인·재시도)를 받는다.
const LOOP_RUN = "Loop 실행";
function loopWorkflow(catalog, project, ref) {
  const loop = catalog.versionOf(string(ref?.id, "loop"), ref?.version === undefined ? undefined
    : integer(ref.version, "loop version", 1, Number.MAX_SAFE_INTEGER));
  if (!catalog.availableTo(loop, project) || loop.kind !== "loop") throw problem(400, "Select a Loop available to this project");
  const document = {
    nodes: [{ id: "start", label: "Start", type: "start", x: 35, y: 90 },
      { id: "loop", label: loop.name.slice(0, 120), type: "loop", definition: loop.id, version: loop.version, x: 195, y: 90,
        instruction: "실행 지시에 적힌 작업을 수행하고 Loop 검사를 통과시키세요." },
      { id: "end", label: "End", type: "end", x: 355, y: 90 }],
    edges: [{ from: "start", to: "loop", port: "next" }, { from: "loop", to: "end", port: "next" }],
  };
  const key = createHash("sha256").update(JSON.stringify(document)).digest("hex").slice(0, 12);
  return { loop, payload: { name: `${LOOP_RUN} · ${loop.name.slice(0, 200)} · ${key}`, ...document } };
}

function loopLaunch(catalog, workflows, flow, runner, input) {
  const project = string(input.project, "project");
  const title = string(input.title, "run title");
  const instruction = string(input.instruction, "작업 지시", 12000);
  const { loop, payload } = loopWorkflow(catalog, project, { id: input.definition, version: input.version });
  // 시간·예산은 Loop 정의의 값을 Workflow 실행 한도 안에서 쓴다.
  const timeoutMs = Math.min(3600000, Math.max(100, loop.payload.timeoutMs ?? 1200000));
  const budgetCents = Math.min(100000, Math.max(0, loop.payload.budgetCents ?? 0));
  return flow.start({ project, title, timeoutMs, budgetCents, instruction }, input.key, {
    source: { loop: loop.id, version: loop.version },
    prepare() {
      prepareRuntime(catalog, runner, workflows.executionPlan(project, payload), project);
      return workflows.ensurePreset(project, payload);
    },
  });
}

function prepareRuntime(catalog, runner, plan, project) {
  const nodes = plan.document.nodes.filter(({ type }) => ["agent", "loop", "command"].includes(type));
  const status = runner.status?.();
  if (nodes.length && status && status.status !== "ready") throw problem(409, status.detail);
  for (const node of nodes.filter(({ type }) => type !== "command")) {
    const { harness, model, loop } = nodeDefinitions(catalog, project, node);
    try { runner.requireAdapter(harness.payload, model.payload, loop?.checks ?? []); }
    catch (error) {
      if (error.status !== 409) throw error;
      throw problem(409, node.label + " · " + error.message);
    }
  }
}

function quickLaunch(catalog, workflows, flow, runner, input) {
  const project = string(input.project, "project");
  const goal = string(input.goal, "작업 목표", 8000);
  const acceptance = string(input.acceptance, "완료 조건", 3500);
  const source = input.workflow ? {
    workflow: string(input.workflow, "workflow"), version: integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER),
  } : { preset: string(input.preset, "template"), refs: input.refs };
  return flow.start({ ...input, project, instruction: "작업 목표\n" + goal + "\n\n완료 조건\n" + acceptance }, input.key, {
    source,
    prepare() {
      const stored = source.workflow ? workflows.get(project, source.workflow, source.version) : null;
      const payload = stored?.payload ?? makePreset(catalog, project, source);
      prepareRuntime(catalog, runner, workflows.executionPlan(project, payload, stored?.id), project);
      return stored ?? workflows.ensurePreset(project, payload);
    },
  });
}

module.exports = { quickLaunch, loopLaunch, LOOP_RUN };
