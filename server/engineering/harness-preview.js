"use strict";

const { definition, integer, string } = require("./definitions");
const { promptSections } = require("./adapters");
const { resolveSources, withSources, sourceReferences } = require("./harness-sources");
const { problem } = require("./state");

function resolveHarness(catalog, input) {
  const project = catalog.project(string(input.project, "project"));
  const record = input.id ? catalog.versionOf(string(input.id, "harness id"),
    integer(input.version, "harness version", 1, Number.MAX_SAFE_INTEGER)) : null;
  if (record && (!catalog.availableTo(record, project.id) || record.kind !== "harness")) {
    throw problem(400, "The harness does not belong to the project");
  }
  const harness = record?.payload ?? definition("harness", input.payload);
  const model = record ? catalog.dependency(record) : catalog.versionOf(harness.model);
  if (!model || !catalog.availableTo(model, project.id) || model.kind !== "model") {
    throw problem(400, "The model does not belong to the project");
  }

  return { project, record, harness, model };
}

async function previewHarness(catalog, runner, input) {
  const { project, record, harness, model } = resolveHarness(catalog, input);
  const sources = await resolveSources(harness, project);
  let policy = null;
  let blockedReason = null;
  try {
    if (project.archived) throw problem(409, "프로젝트가 보관되어 있습니다.");
    const runtime = runner.status?.();
    if (runtime && runtime.status !== "ready") throw problem(409, runtime.detail);
    policy = runner.requireAdapter(harness, model.payload, []).executionPolicy ?? null;
  } catch (error) {
    if (error.status !== 409) throw error;
    blockedReason = error.message;
  }

  return {
    profile: { name: harness.name, adapter: harness.adapter, version: record?.version ?? null },
    model: { name: model.name, version: model.version, provider: model.payload.provider,
      id: model.payload.model, reasoning: model.payload.reasoning },
    prompt: promptSections(withSources(harness, sources)),
    sources: sourceReferences(sources),
    workflowInputs: harness.assets?.inputs ?? [],
    assets: { mcp: "draft-only", hooks: "draft-only" },
    ready: blockedReason === null,
    policy,
    blockedReason,
  };
}

module.exports = { previewHarness, resolveHarness };
