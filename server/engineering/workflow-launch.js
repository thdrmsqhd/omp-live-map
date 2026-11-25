"use strict";

const { createHash } = require("node:crypto");
const { integer, string } = require("./definitions");
const { buildPreset, listPresets } = require("./workflow-presets");
const { problem } = require("./state");

function profile(catalog, project, ref, kind) {
  const entry = catalog.versionOf(string(ref?.id, kind), integer(ref?.version, "definition version", 1, Number.MAX_SAFE_INTEGER));
  if (entry.project !== project || entry.kind !== kind) throw problem(400, "Template profile has the wrong project or kind");
  return entry;
}

function makePreset(catalog, project, source) {
  const preset = listPresets().find(({ id }) => id === source.preset);
  if (!preset) throw problem(400, "Unknown workflow template");
  const refs = {};
  for (const name of ["author", "reviewer", "loop"]) {
    if (preset[name]) refs[name] = profile(catalog, project, source.refs?.[name], name === "loop" ? "loop" : "harness");
  }
  const document = buildPreset(preset.id, Object.fromEntries(Object.entries(refs).map(([key, value]) => [key, value.id])));
  for (const node of document.nodes.filter(({ definition }) => definition)) {
    const ref = refs[node.type === "loop" ? "loop" : node.id === "review" ? "reviewer" : "author"];
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

function prepareRuntime(catalog, runner, plan) {
  const nodes = plan.document.nodes.filter(({ type }) => ["agent", "loop", "command"].includes(type));
  const status = runner.status?.();
  if (nodes.length && status && status.status !== "ready") throw problem(409, status.detail);
  for (const node of nodes.filter(({ definition }) => definition)) {
    const entry = catalog.versionOf(node.definition, node.version);
    const harness = node.type === "loop" ? catalog.dependency(entry) : entry;
    const model = harness && catalog.dependency(harness);
    if (!model) throw problem(409, node.label + " · 연결된 하네스나 모델이 없습니다.");
    try { runner.requireAdapter(harness.payload, model.payload, node.type === "loop" ? entry.payload.checks : []); }
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
      prepareRuntime(catalog, runner, workflows.executionPlan(project, payload, stored?.id));
      return stored ?? workflows.ensurePreset(project, payload);
    },
  });
}

module.exports = { quickLaunch };
