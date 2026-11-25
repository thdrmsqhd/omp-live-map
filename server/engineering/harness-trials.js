"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { git } = require("./catalog");
const { integer, string } = require("./definitions");
const { resolveHarness } = require("./harness-preview");
const { resolveSources, withSources, sourceReferences } = require("./harness-sources");
const { verifyResult } = require("./harness-result");
const { problem, redact } = require("./state");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sides = ["baseline", "draft"];

function pinnedMaterials(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 5) {
    throw problem(400, "Supply up to five named trial inputs");
  }
  return new Map(Object.entries(value).map(([input, text]) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input) || typeof text !== "string" || Buffer.byteLength(text) > 16 * 1024 ||
        text.includes("\0")) throw problem(400, "Invalid trial material");
    return [input, { kind: "trial-input", input, path: input, text, sha256: hash(text) }];
  }));
}

function profileInfo({ record, harness, model }) {
  return { name: harness.name, id: record?.id ?? null, version: record?.version ?? null, adapter: harness.adapter,
    model: { id: model.id, name: model.payload.model, version: model.version, provider: model.payload.provider,
      reasoning: model.payload.reasoning } };
}

function harnessTrials(catalog, runner, workspace, budget) {
  const trials = new Map();
  const active = new Map();

  function get(id, project) {
    const trial = trials.get(string(id, "comparison id"));
    if (!trial || trial.project.id !== project) throw problem(404, "Harness comparison not found");
    return trial;
  }

  function view(trial) {
    return { id: trial.id, commit: trial.commit, inputHash: trial.inputHash, modelChanged: trial.modelChanged,
      status: trial.status, results: trial.results, materialHashes: sourceReferences([...trial.materials.values()]),
      profiles: Object.fromEntries(sides.map((side) => [side, profileInfo(trial.profiles[side])])),
    };
  }

  async function execute(trial, queue, hold, control, runtime) {
    const signal = AbortSignal.any([control.signal, AbortSignal.timeout(trial.timeoutMs)]);
    let total = 0;
    let uncertain = false;
    try {
      for (const side of queue) {
        if (signal.aborted) {
          trial.results[side] = { status: control.signal.aborted ? "cancelled" : "timed_out" };
          continue;
        }
        const start = Date.now();
        const fixture = { id: randomUUID() };
        const { harness, model } = trial.profiles[side];
        trial.results[side] = { status: "running" };
        let location;
        let charged = false;
        try {
          const adapter = runtime.requireAdapter(harness, model.payload, []);
          location = await workspace.create(trial.project, fixture, null, trial.commit);
          const repository = await resolveSources(harness, trial.project, location, [], signal, { trial: true });
          const sources = [...repository, ...(harness.assets?.inputs ?? []).map((name) => trial.materials.get(name))];
          const effective = withSources(harness, sources);
          charged = true;
          const result = await adapter.run({ cwd: location, harness: effective, model: model.payload,
            instruction: trial.instruction, feedback: [], signal, budgetCents: trial.budgetCents, capture: true });
          signal.throwIfAborted();
          if (!Number.isFinite(result.costCents) || result.costCents < 0 || result.costCents > trial.budgetCents) {
            throw problem(409, "Comparison did not return valid cost");
          }
          total += result.costCents;
          charged = false;
          const validation = await verifyResult(harness.result, location, signal);
          const workspaceResult = validation ? { path: validation.path, passed: validation.passed, errors: validation.errors,
            sha256: validation.sha256, output: redact(JSON.stringify(validation.value, null, 2)) } : null;
          trial.results[side] = { status: validation?.passed === false ? "failed" : "succeeded",
            sessionId: result.sessionId, costCents: result.costCents, costBasis: result.costBasis,
            elapsedMs: Date.now() - start, sources: sourceReferences(sources), validation: workspaceResult,
            output: result.output ?? null, tools: result.tools ?? null };
        } catch (error) {
          uncertain ||= charged;
          trial.results[side] = { status: control.signal.aborted ? "cancelled" : signal.aborted ? "timed_out" : "failed",
            error: redact(error.message), elapsedMs: Date.now() - start };
        } finally {
          if (location) {
            try { await workspace.remove(trial.project, location); }
            catch { trial.results[side].workspace = location; }
          }
        }
      }
      trial.status = control.signal.aborted ? "cancelled" : signal.aborted ? "timed_out" : "finished";
    } finally {
      try { if (!uncertain) budget.settleTrial(hold, total); }
      finally { active.delete(trial.project.id); }
    }
  }

  function launch(trial, queue) {
    if (active.has(trial.project.id)) throw problem(409, "A harness comparison is already running for the project");
    const runtime = runner.snapshot?.() ?? runner;
    for (const side of queue) {
      const { harness, model } = trial.profiles[side];
      runtime.requireAdapter(harness, model.payload, []);
    }
    const hold = budget.reserveTrial(trial.project.id, trial.budgetCents * queue.length);
    const control = new AbortController();
    active.set(trial.project.id, control);
    trial.status = "running";
    for (const side of queue) trial.results[side] = { status: "queued" };
    void execute(trial, queue, hold, control, runtime).catch(() => { trial.status = "failed"; });
  }

  return {
    async start(project, body) {
      const key = string(body.key, "comparison request key", 64);
      const id = project + ":" + key;
      const requestHash = hash(JSON.stringify(body));
      const existing = trials.get(id);
      if (existing) {
        if (existing.requestHash !== requestHash) throw problem(409, "Comparison key already used with different settings");
        return view(existing);
      }
      const baseline = resolveHarness(catalog, { project, id: string(body.baseline?.id, "baseline id"), version: body.baseline?.version });
      const draft = resolveHarness(catalog, { project, payload: body.payload });
      if (baseline.project.archived) throw problem(409, "Project is archived");
      const instruction = string(body.instruction, "trial instruction", 12000);
      const materials = pinnedMaterials(body.materials);
      for (const profile of [baseline, draft]) {
        for (const name of profile.harness.assets?.inputs ?? []) {
          if (!materials.has(name)) throw problem(400, "Trial input is missing: " + name);
        }
      }
      const budgetCents = integer(body.budgetCents, "trial budget per side", 1, 100000);
      const timeoutMs = integer(body.timeoutMs, "comparison timeout", 1000, 20 * 60 * 1000);
      const root = baseline.project.root;
      const commit = await git(root, ["rev-parse", "--verify", "refs/heads/" + baseline.project.branch + "^{commit}"]);
      if (trials.has(id)) return this.start(project, body);
      const trial = { id, requestHash, project: baseline.project, commit, instruction, materials, budgetCents, timeoutMs,
        profiles: { baseline, draft }, modelChanged: baseline.model.id !== draft.model.id || baseline.model.version !== draft.model.version,
        inputHash: hash(JSON.stringify([commit, instruction, sourceReferences([...materials.values()])])), results: {} };
      launch(trial, sides);
      trials.set(id, trial);
      if (trials.size > 20) {
        const old = [...trials.values()].find((entry) => entry.status !== "running");
        if (old) trials.delete(old.id);
      }
      return view(trial);
    },
    inspect(project, id) { return view(get(id, project)); },
    cancel(project, id) {
      const trial = get(id, project);
      if (trial.status === "running") active.get(project)?.abort();
      return view(trial);
    },
    retry(project, id, side) {
      const trial = get(id, project);
      if (!sides.includes(side) || !["failed", "cancelled", "timed_out"].includes(trial.results[side]?.status)) {
        throw problem(409, "Only an unsuccessful comparison side can be retried");
      }
      launch(trial, [side]);
      return view(trial);
    },
  };
}

module.exports = { harnessTrials };
