"use strict";

const { resolveSources, withSources, sourceReferences } = require("./harness-sources");
const { executionDefinitions } = require("./harness-provenance");
const { verifyResult } = require("./harness-result");
const { problem, redact } = require("./state");

function loopEngine(store, catalog, runner, folders) {
  const active = new Map();
  function resolve(run) {
    const loop = catalog.versionOf(run.definition, run.version);
    const harness = catalog.dependency(loop);
    const model = harness && catalog.dependency(harness);
    if (!model) throw problem(409, "Loop requires a saved harness and model version");
    return { loop: loop.payload, harness: harness.payload, model: model.payload, definitions: executionDefinitions(harness, model) };
  }
  async function execute(id) {
    const run = store.get(id);
    const { loop, harness, model, definitions } = resolve(run);
    const execution = runner.snapshot?.() ?? runner;
    const agent = execution.requireAdapter(harness, model, loop.checks);
    const stop = new AbortController();
    const control = { stop, pause: false };
    active.set(id, control);
    try {
      const remaining = run.deadline - Date.now();
      if (remaining <= 0) return store.change(id, "limit_exceeded");
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(remaining)]);
      store.change(id, "running");
      const workspace = run.workspace ?? await folders.create(catalog.project(run.project), run);
      store.workspace(id, workspace);
      const project = catalog.project(run.project);
      const history = store.attempts(id);
      let feedback = history.at(-1)?.outcome?.checks ?? [];
      let used = history.reduce((cost, attempt) => cost + (attempt.outcome?.costCents ?? 0), 0);
      for (let index = history.length; index < loop.attempts; index++) {
        signal.throwIfAborted();
        if (control.pause) return store.change(id, "paused");
        if (used >= loop.budgetCents && loop.budgetCents > 0) return store.change(id, "limit_exceeded");
        const number = store.startAttempt(id);
        try {
          const sources = await resolveSources(harness, project, workspace, [], signal);
          const output = await agent.run({
            cwd: workspace, instruction: run.instruction, harness: withSources(harness, sources), model,
            feedback, signal, budgetCents: loop.budgetCents - used, capture: true,
          });
          signal.throwIfAborted();
          if (!Number.isFinite(output.costCents) || output.costCents < 0) {
            throw new Error("The adapter returned no valid usage");
          }
          used += output.costCents;
          const overBudget = used > loop.budgetCents;
          const results = overBudget ? [] : await execution.verify(loop.checks, workspace, signal);
          const validation = overBudget ? null : await verifyResult(harness.result, workspace, signal);
          if (validation) results.push({ command: "harness result", passed: validation.passed, log: validation.errors.join("\n") });
          const passed = !overBudget && results.every((result) => result.passed);
          store.finishAttempt(id, number, passed ? "passed" : "rejected", {
            checks: results, costCents: output.costCents, costBasis: output.costBasis ?? "reported", sessionId: output.sessionId ?? null,
            model: model.model, agent: harness.adapter, sources: sourceReferences(sources), definitions, tools: output.tools ?? null,
            ...(validation ? { result: validation } : {}),
          });
          if (overBudget) return store.change(id, "limit_exceeded");
          if (passed) return store.change(id, "succeeded");
          feedback = results;
        } catch (error) {
          store.finishAttempt(id, number, signal.aborted ? "cancelled" : "error", { error: redact(error.message), definitions });
          if (stop.signal.aborted) return store.change(id, "cancelled");
          return store.change(id, signal.aborted ? "limit_exceeded" : "failed");
        }
      }
      return store.change(id, "limit_exceeded");
    } catch (error) {
      if (store.get(id).status === "running") {
        return store.change(id, stop.signal.aborted ? "cancelled" :
          Date.now() >= run.deadline ? "limit_exceeded" : "failed");
      }
      throw error;
    } finally {
      active.delete(id);
    }
  }
  function action(id, operation) {
    const state = store.get(id);
    const control = active.get(id);
    if (operation === "pause" && control) {
      control.pause = true;
      return state;
    }
    if (operation === "cancel") {
      if (control) {
        control.stop.abort();
        return state;
      }
      return store.change(id, "cancelled");
    }
    if (operation === "resume" && state.status === "paused" && !control) {
      void execute(id).catch((error) => console.error("Loop resume failed:", redact(error.message)));
      return store.get(id);
    }
    throw problem(409, "Action is unavailable for this run");
  }
  return {
    action, execute,
    start(body, key) {
      const result = store.create(body, key);
      if (!result.created) return result.run;
      try {
        const { loop, harness, model } = resolve(result.run);
        runner.requireAdapter(harness, model, loop.checks);
      } catch (error) {
        store.block(result.run.id, redact(error.message));
        return store.get(result.run.id);
      }
      void execute(result.run.id).catch((error) => console.error("Loop start failed:", redact(error.message)));
      return store.get(result.run.id);
    },
  };
}

module.exports = { loopEngine };
