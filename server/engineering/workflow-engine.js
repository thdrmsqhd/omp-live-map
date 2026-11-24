"use strict";

const { graphScheduler } = require("./graph-scheduler");
const { nodeExecutor } = require("./workflow-node-executor");
const { validateArtifacts, verifyInputs, collectOutputs } = require("./workflow-artifact");
const { runParallel } = require("./workflow-parallel");
const { problem, redact } = require("./state");

const external = ({ type }) => ["agent", "loop", "command"].includes(type);

function workflowEngine(store, workflows, catalog, runner, worktrees) {
  const active = new Map(), queue = new Set();

  async function execute(id) {
    if (active.has(id)) return;
    const control = { stop: new AbortController(), pause: false };
    active.set(id, control);
    const { stop } = control;
    const run = store.get(id);
    const runtime = runner.snapshot?.() ?? runner;
    const runNode = nodeExecutor(catalog, runtime);
    let workspace = run.workspace;
    const operating = new Set();
    let signal;
    async function ensureWorkspace() {
      if (!workspace) {
        workspace = await worktrees.create(catalog.project(run.project), run);
        store.workspace(id, workspace);
      }
      signal.throwIfAborted();
    }
    function begin(node) {
      store.begin(id, node.id);
      operating.add(node.id);
    }
    function finish(node, status, result) {
      store.finish(id, node, status, result);
      operating.delete(node);
    }
    async function executeExternal(node, location, remaining) {
      let result = await runNode(node, run.project, location, Math.max(0, remaining), signal);
      if (result.status === "succeeded" && node.outputs.length) {
        try { result.artifacts = await collectOutputs(location, node, signal); } catch (error) {
          result = { ...result, status: "failed", interrupted: true, error: redact(error.message) };
        }
      }
      return result;
    }
    try {
      if (run.deadline <= Date.now()) {
        store.change(id, ["queued", "paused", "interrupted"], "limit_exceeded");
        return;
      }
      signal = AbortSignal.any([stop.signal, AbortSignal.timeout(run.deadline - Date.now())]);
      const definition = workflows.get(run.project, run.workflow, run.version);
      const plan = workflows.executionPlan(run.project, definition.payload, run.workflow);
      const scheduler = graphScheduler(plan);
      const results = new Map(store.nodes(id).map(({ node, status, outcome }) => [node, { ...outcome, status }]));
      const earlier = store.retries(id).map(({ outcome }) => outcome);
      let remaining = run.budget - [...results.values(), ...earlier].reduce((sum, result) => sum + (result.costCents ?? 0), 0);
      store.change(id, ["queued", "paused", "interrupted"], "running");
      const approved = [...results.values()].filter((result) => result.port === "approved");
      for (const decision of approved) await validateArtifacts(workspace, decision.artifacts ?? [], signal);
      for (;;) {
        signal.throwIfAborted();
        if (control.pause) { store.change(id, ["running"], "paused"); return; }
        const { ready, skipped } = scheduler.advance(results);
        if (skipped.length) {
          store.skip(id, skipped);
          for (const item of skipped) results.set(item, { status: "skipped" });
        }
        const node = ready[0];
        if (!node) {
          store.change(id, ["running"], scheduler.outcome(results) ?? "failed");
          return;
        }
        const batch = external(node) ? ready.filter(external).slice(0, 2) : [];
        let outcomes;
        if (batch.length > 1) {
          await ensureWorkspace();
          for (const branch of batch) await verifyInputs(workspace, branch, results, signal);
          for (const branch of batch) begin(branch);
          const agents = batch.filter(({ type }) => type !== "command").length;
          const share = Math.floor(Math.max(0, remaining) / Math.max(1, agents));
          outcomes = await runParallel({ project: catalog.project(run.project), workspace, worktrees, nodes: batch, signal,
            priorArtifacts: [...results.values()].flatMap(({ artifacts }) => artifacts?.map(({ path }) => path) ?? []),
            execute: (item, location) => executeExternal(item, location, item.type === "command" ? 0 : share) });
        } else {
          const artifacts = node.inputs.length ? await verifyInputs(workspace, node, results, signal) : [];
          signal.throwIfAborted();
          if (node.type === "approval") { store.ask(id, node.id, node.prompt, artifacts); return; }
          begin(node);
          let result = { status: "succeeded" };
          if (node.type === "condition") result.port = scheduler.conditionPort(node, results);
          if (external(node)) {
            await ensureWorkspace();
            result = await executeExternal(node, workspace, remaining);
          }
          outcomes = [{ node, result }];
        }
        for (const { node, result } of outcomes) {
          remaining -= result.costCents ?? 0;
          finish(node.id, signal.aborted ? "cancelled" : result.status, result);
          results.set(node.id, result);
        }
        signal.throwIfAborted();
        if (remaining < 0) { store.change(id, ["running"], "limit_exceeded"); return; }
        const incomplete = outcomes.find(({ result }) => result.interrupted);
        if (incomplete) { store.change(id, ["running"], "failed", incomplete.result.error); return; }
      }
    } catch (error) {
      const status = stop.signal.aborted ? "cancelled" : signal?.aborted ? "limit_exceeded" : "failed";
      const uncertainBatch = operating.size > 1;
      for (const node of operating) finish(node, signal?.aborted ? "cancelled" : uncertainBatch ? "interrupted" : "failed",
        { error: redact(error.message) });
      store.change(id, ["running", "queued", "paused", "interrupted"],
        uncertainBatch && !signal?.aborted ? "interrupted" : status, error.message);
    } finally {
      active.delete(id);
    }
  }

  function dispatch() {
    if (active.size) return;
    for (const id of queue) {
      queue.delete(id);
      if (!["queued", "paused", "interrupted"].includes(store.get(id).status)) continue;
      void execute(id).catch((error) => console.error("Workflow execution failed:", redact(error.message))).finally(dispatch);
      return;
    }
  }

  function launch(id) {
    queue.add(id);
    dispatch();
  }

  return {
    start(input, key) {
      const { run, created } = store.create(input, key);
      if (created) launch(run.id);
      return store.get(run.id);
    },
    async decide(id, node, decision, reason) {
      const run = store.get(id);
      const waiting = store.nodes(id).find((item) => item.node === node && item.status === "waiting_approval");
      if (run.status !== "waiting_approval" || !waiting) throw problem(409, "Approval is not pending");
      if (decision === "approved" && waiting.outcome?.artifacts?.length) {
        await validateArtifacts(run.workspace, waiting.outcome.artifacts);
      }
      store.decide(id, node, decision, reason);
      launch(id);
      return store.get(id);
    },
    retry(id, node) {
      const run = store.get(id);
      if (active.has(id)) throw problem(409, "Workflow is still active");
      const saved = workflows.get(run.project, run.workflow, run.version);
      const workflow = workflows.executionPlan(run.project, saved.payload, run.workflow).document;
      const children = new Map(workflow.nodes.map((item) => [item.id, []]));
      for (const edge of workflow.edges) children.get(edge.from).push(edge.to);
      const descendants = new Set(), pending = [...(children.get(node) ?? [])];
      while (pending.length) {
        const child = pending.pop();
        if (descendants.has(child)) continue;
        descendants.add(child);
        pending.push(...children.get(child));
      }
      store.retry(id, node, descendants);
      launch(id);
      return store.get(id);
    },
    action(id, action) {
      const run = store.get(id), current = active.get(id);
      if (action === "pause" && current) current.pause = true;
      else if (action === "cancel" && current) current.stop.abort();
      else if (action === "cancel") store.change(id, ["queued", "paused", "waiting_approval", "interrupted"], "cancelled");
      else if (action === "resume" && !current && ["paused", "interrupted"].includes(run.status) &&
          !store.nodes(id).some(({ status }) => status === "interrupted")) launch(id);
      else throw problem(409, "Workflow action is unavailable or an external result is uncertain");
      return store.get(id);
    },
  };
}

module.exports = { workflowEngine };
