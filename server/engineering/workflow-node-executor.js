"use strict";

const { resolveSources, withSources, sourceReferences } = require("./harness-sources");
const { executionDefinitions } = require("./harness-provenance");
const { verifyResult } = require("./harness-result");
const { promptSections } = require("./adapters");
const { problem, redact } = require("./state");

function nodeDefinitions(catalog, project, node) {
  const profile = node.sessionProfile;
  if (profile) {
    const { id, version, name, adapter, role, instructions } = profile;
    return {
      harness: { id, version, payload: { name, adapter, role, instructions, permission: "workspace-only" } },
      model: { id, version, payload: { name: profile.model, model: profile.model, provider: adapter === "claude" ? "anthropic" : profile.provider, reasoning: "" } },
    };
  }
  const target = catalog.versionOf(node.definition, node.version);
  if (!catalog.availableTo(target, project) || target.kind !== (node.type === "agent" ? "harness" : "loop")) {
    throw problem(409, "Pinned workflow execution definition is invalid");
  }
  const loop = node.type === "loop" ? target.payload : null;
  const harness = loop ? catalog.dependency(target) : target;
  const model = harness && catalog.dependency(harness);
  if (!model) throw problem(409, "No pinned model for workflow execution node");
  return { loop, harness, model };
}

function nodeExecutor(catalog, runner) {
  // report: 관제 화면용 진행 콜백(workflow-live). 없으면 아무것도 하지 않는다.
  return async function execute(node, project, workspace, remaining, signal, inputs = [], report = () => {}) {
    if (node.type === "command") {
      report({ phase: "command", tool: [node.check.command, ...node.check.args].join(" ") });
      const checks = await runner.verify([node.check], workspace, signal);
      const passed = checks.every((check) => check.passed);
      return { status: passed ? "succeeded" : "failed", passed, checks };
    }
    const { loop, harness, model } = nodeDefinitions(catalog, project, node);
    const checks = loop?.checks ?? [];
    const definitions = executionDefinitions(harness, model);
    if (node.verificationOnly) {
      report({ phase: "verifying" });
      const results = await runner.verify(checks, workspace, signal);
      const validation = await verifyResult(harness.payload.result, workspace, signal);
      const passed = results.every((check) => check.passed) && validation?.passed !== false;
      return { status: passed ? "succeeded" : "failed", passed, checks: results, result: validation,
        definitions, verificationOnly: true, costCents: 0 };
    }
    const adapter = runner.requireAdapter(harness.payload, model.payload, checks);
    const timeout = loop ? AbortSignal.any([signal, AbortSignal.timeout(loop.timeoutMs)]) : signal;
    const budget = Math.min(remaining, loop?.budgetCents ?? remaining);
    let spent = 0;
    let feedback = [];
    const attempts = [];
    try {
      report({ phase: "sources", attempts: loop?.attempts ?? 1 });
      const sources = await resolveSources(harness.payload, catalog.project(project), workspace, inputs, timeout);
      const effective = withSources(harness.payload, sources);
      if (effective.result && !node.outputs.some(({ path }) => path === effective.result.path)) {
        throw problem(409, "Workflow node must declare the harness result file as an output: " + effective.result.path);
      }
      for (let index = 0; index < (loop?.attempts ?? 1) && spent < budget; index++) {
        timeout.throwIfAborted();
        let sections = [];
        try { sections = promptSections(effective, node.instruction, feedback).map(({ name, text }) => ({ name, chars: text.length })); } catch { /* 표시용 */ }
        report({ phase: "prompting", attempt: index + 1, reset: true, sections });
        const output = await adapter.run({ cwd: workspace, instruction: node.instruction, harness: effective,
          model: model.payload, feedback, budgetCents: budget - spent, signal: timeout, capture: true, onProgress: report });
        if (!Number.isFinite(output.costCents) || output.costCents < 0) throw new Error("Missing valid runtime usage");
        spent += output.costCents;
        attempts.push({ costCents: output.costCents, costBasis: output.costBasis, sessionId: output.sessionId,
          model: model.payload.model, agent: harness.payload.adapter, sources: sourceReferences(sources), tools: output.tools ?? null });
        if (spent > budget) break;
        timeout.throwIfAborted();
        if (checks.length) report({ phase: "verifying" });
        feedback = checks.length ? await runner.verify(checks, workspace, timeout) : [];
        const validation = await verifyResult(effective.result, workspace, timeout);
        if (validation) {
          attempts.at(-1).result = validation;
          feedback.push({ command: "harness result", passed: validation.passed, log: validation.errors.join("\n") });
        }
        attempts.at(-1).checks = feedback;
        if (feedback.every((check) => check.passed)) return { status: "succeeded", passed: true, costCents: spent, definitions, attempts };
      }
      return { status: "failed", passed: false, costCents: spent, definitions, attempts };
    } catch (error) {
      return { status: "failed", passed: false, costCents: spent, definitions, attempts, error: redact(error.message), interrupted: true };
    }
  };
}

module.exports = { nodeExecutor, nodeDefinitions };
