"use strict";

const { resolveSources, withSources, sourceReferences } = require("./harness-sources");
const { problem, redact } = require("./state");

function nodeExecutor(catalog, runner) {
  return async function execute(node, project, workspace, remaining, signal, inputs = []) {
    if (node.type === "command") {
      const checks = await runner.verify([node.check], workspace, signal);
      const passed = checks.every((check) => check.passed);
      return { status: passed ? "succeeded" : "failed", passed, checks };
    }
    const target = catalog.versionOf(node.definition, node.version);
    if (target.project !== project || target.kind !== (node.type === "agent" ? "harness" : "loop")) {
      throw problem(409, "Pinned workflow execution definition is invalid");
    }
    const loop = node.type === "loop" ? target.payload : null;
    const harness = loop ? catalog.dependency(target) : target;
    const model = harness && catalog.dependency(harness);
    if (!model) throw problem(409, "No pinned model for workflow execution node");
    const checks = loop?.checks ?? [];
    const adapter = runner.requireAdapter(harness.payload, model.payload, checks);
    const timeout = loop ? AbortSignal.any([signal, AbortSignal.timeout(loop.timeoutMs)]) : signal;
    const budget = Math.min(remaining, loop?.budgetCents ?? remaining);
    let spent = 0;
    let feedback = [];
    const attempts = [];
    try {
      const sources = await resolveSources(harness.payload, catalog.project(project), workspace, inputs, timeout);
      const effective = withSources(harness.payload, sources);
      for (let index = 0; index < (loop?.attempts ?? 1) && spent < budget; index++) {
        timeout.throwIfAborted();
        const output = await adapter.run({ cwd: workspace, instruction: node.instruction, harness: effective,
          model: model.payload, feedback, budgetCents: budget - spent, signal: timeout });
        if (!Number.isFinite(output.costCents) || output.costCents < 0) throw new Error("Missing valid runtime usage");
        spent += output.costCents;
        attempts.push({ costCents: output.costCents, costBasis: output.costBasis, sessionId: output.sessionId,
          model: model.payload.model, agent: harness.payload.adapter, sources: sourceReferences(sources) });
        if (spent > budget) break;
        timeout.throwIfAborted();
        feedback = checks.length ? await runner.verify(checks, workspace, timeout) : [];
        attempts.at(-1).checks = feedback;
        if (feedback.every((check) => check.passed)) return { status: "succeeded", passed: true, costCents: spent, attempts };
      }
      return { status: "failed", passed: false, costCents: spent, attempts };
    } catch (error) {
      return { status: "failed", passed: false, costCents: spent, attempts, error: redact(error.message), interrupted: true };
    }
  };
}

module.exports = { nodeExecutor };
