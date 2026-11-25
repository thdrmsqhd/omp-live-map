"use strict";

const { timingSafeEqual } = require("node:crypto");
const path = require("node:path");
const { openDatabase } = require("./database");
const { catalog } = require("./catalog");
const { workflowCatalog } = require("./workflow-catalog");
const { workflowRuns } = require("./workflow-runs");
const { workflowEngine } = require("./workflow-engine");
const { workflowTemplates } = require("./workflow-templates");
const { sdlcTasks } = require("./sdlc-tasks");
const { sdlcStages } = require("./sdlc-stages");
const { workflowObservability } = require("./workflow-observability");
const { workflowDelivery } = require("./workflow-delivery");
const { retryOptions } = require("./workflow-retry-plan");
const { quickLaunch } = require("./workflow-launch");
const { addPresetDefinitions, buildPreset, listPresets } = require("./workflow-presets");
const { projectBudget } = require("./project-budget");
const { workflowStaging } = require("./workflow-staging");
const { runStore } = require("./run-store");
const { loopEngine } = require("./loop");
const { secureRunner } = require("./runner");
const { worktrees } = require("./worktree");
const { harnessTrials } = require("./harness-trials");
const { previewHarness } = require("./harness-preview");
const { integer, string } = require("./definitions");
const { problem } = require("./state");

const prefix = "/api/engineering/";
const limit = 64 * 1024;
function reply(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw problem(413, "Request is too large");
  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw problem(400, "JSON object required");
  }
}
function authenticated(req, token) {
  if (!token) return false;
  const supplied = Buffer.from(String(req.headers["x-omp-engineering-token"] ?? ""));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function createEngineeringRoutes({ token, directory, runner = secureRunner() }) {
  let services;
  function initialize() {
    if (services) return services;
    const db = openDatabase(path.resolve(directory, "engineering.sqlite"));
    try {
      const definitions = catalog(db);
      const runs = runStore(db, definitions);
      const workflows = workflowCatalog(db, definitions);
      const tasks = sdlcTasks(db, definitions, workflows);
      const flowRuns = workflowRuns(db, definitions, workflows, tasks);
      const workspaceRoot = path.resolve(directory, "worktrees");
      const workspace = worktrees(workspaceRoot);
      const delivery = workflowDelivery(db, flowRuns, definitions, workspaceRoot);
      runs.recover();
      flowRuns.recover();
      const budget = projectBudget(db);
      services = { definitions, workflows, runs, flowRuns, tasks, budget, trials: harnessTrials(definitions, runner, workspace, budget),
        presetDefinitions: (project) => addPresetDefinitions(db, definitions, project),
        stages: sdlcStages(db, definitions, workflows),
        observability: workflowObservability(db, flowRuns, workspaceRoot),
        delivery, staging: workflowStaging(db, delivery),
        templates: workflowTemplates(definitions, workflows),
        flow: workflowEngine(flowRuns, workflows, definitions, runner, workspace),
        loop: loopEngine(runs, definitions, runner, workspace) };
      return services;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  async function route(req, res, url) {
    if (!authenticated(req, token)) return reply(res, 403, { error: "Engineering session is required" });
    try {
      const { definitions, workflows, runs, loop, flowRuns, flow, templates, tasks, stages, observability, delivery, budget, staging, trials, presetDefinitions } = initialize();
      const endpoint = url.pathname.slice(prefix.length);
      const query = (key) => string(url.searchParams.get(key), key);
      let result;
      if (req.method === "GET") {
        if (endpoint === "projects") result = definitions.projects();
        if (endpoint === "tasks") result = tasks.list(query("project"));
        if (endpoint === "sdlc-stages") result = stages.list(query("project"));
        if (endpoint === "workflow-approvals") result = observability.approvals(query("project"));
        if (endpoint === "workflow-live-map") result = observability.liveMapRuns();
        if (endpoint === "workflow-dashboard") result = observability.dashboard(query("project"),
          integer(Number(url.searchParams.get("days") ?? 30), "metrics period", 1, 90));
        if (endpoint === "project-budget") result = { current: budget.get(query("project")) ?? null };
        if (endpoint === "workflow-review") result = await observability.review(query("id"));
        if (endpoint === "workflow-artifact") result = await observability.artifact(query("id"), query("node"), query("path"));
        if (endpoint === "workflows") result = workflows.list(query("project"));
        if (endpoint === "workflows/presets") result = listPresets();
        if (endpoint === "workflow-runs") result = flowRuns.list(query("project"));
        if (endpoint === "workflow-run") {
          const id = query("id");
          const run = flowRuns.get(id);
          const workflow = workflows.get(run.project, run.workflow, run.version);
          const { document: graph, display } = workflows.executionPlan(run.project, workflow.payload, run.workflow);
          const nodes = flowRuns.nodes(id);
          result = { run, nodes, interventions: run.status === "failed" ? retryOptions(graph, nodes) : {}, retries: flowRuns.retries(id), timeline: observability.timeline(id),
            delivery: delivery.get(id), staging: staging.get(id),
            labels: Object.fromEntries(graph.nodes.map(({ id, label }) => [id, label])),
            graph: { name: display.name, nodes: display.nodes.map(({ id, label, type, x, y, profileVersion }) => ({ id, label, type, x, y, profileVersion })),
              edges: display.edges } };
        }
        if (endpoint === "workflow") {
          const version = url.searchParams.get("version");
          result = workflows.get(query("project"), query("id"), version === null ? undefined
            : integer(Number(version), "workflow version", 1, Number.MAX_SAFE_INTEGER));
        }
        if (endpoint === "workflows/export") {
          result = templates.export(query("project"), query("id"), integer(Number(query("version")), "workflow version", 1, Number.MAX_SAFE_INTEGER));
        }
        if (endpoint === "teams") result = definitions.teams();
        if (endpoint === "definitions") result = definitions.definitions(
          url.searchParams.get("project"), url.searchParams.get("scope"), url.searchParams.get("team"));
        if (endpoint === "harness/trial") result = trials.inspect(query("project"), query("id"));
        if (endpoint === "harness/uses") result = workflows.harnessUses(query("project"), query("id"));
        if (endpoint === "definitions/version") {
          result = definitions.versionOf(query("id"), integer(Number(query("version")), "version", 1, Number.MAX_SAFE_INTEGER));
        }
        if (endpoint === "runs") result = runs.list(query("project"));
        if (endpoint === "run") {
          const id = query("id");
          result = { run: runs.get(id), attempts: runs.attempts(id), blockedReason: runs.blockedReason(id) };
        }
        if (endpoint === "capabilities") result = { omp: runner.available("omp"), claude: runner.available("claude") };
        if (endpoint === "runtime") {
          if (runner.status?.().status === "unchecked") void runner.prepare();
          result = runner.status?.() ?? { status: "unavailable", detail: "Engineering runtime is unavailable" };
        }
        if (endpoint === "events") {
          const after = integer(Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0), "event cursor", 0, Number.MAX_SAFE_INTEGER);
          const events = runs.events(after);
          if (String(req.headers.accept).includes("text/event-stream")) {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
            for (const entry of events) res.write(`id: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`);
            return res.end();
          }
          result = events;
        }
      }
      if (req.method === "POST") {
        const input = await body(req);
        if (endpoint === "runtime" && runner.prepare) {
          void runner.prepare(input.build === true);
          result = runner.status();
        }
        if (endpoint === "runtime/login" && runner.login) {
          runner.login(input.cancel === true);
          result = runner.status();
        }
        if (endpoint === "projects") result = await definitions.saveProject(input);
        if (endpoint === "project-budget") result = budget.save(string(input.project, "project"), input);
        if (endpoint === "tasks") result = tasks.save(input);
        if (endpoint === "sdlc-stages") result = stages.save(input);
        if (endpoint === "tasks/move") result = tasks.move(string(input.id, "task"), input.status, input.revision);
        if (endpoint === "workflows") result = workflows.save(input);
        if (endpoint === "workflows/save-canvas") result = workflows.saveCanvas(input);
        if (endpoint === "workflows/presets") {
          const payload = buildPreset(input.preset, input.refs ?? {});
          result = workflows.save({ project: input.project, payload: { ...payload, name: input.name || payload.name } });
        }
        if (endpoint === "workflows/presets/defaults") result = presetDefinitions(string(input.project, "project"));
        if (endpoint === "workflows/import") {
          result = templates.import(string(input.project, "project"), input.template, input.name);
        }
        if (endpoint === "workflows/plan") result = workflows.executionPlan(string(input.project, "project"), input.payload,
          input.id ? string(input.id, "workflow") : undefined);
        if (endpoint === "workflow-runs") result = flow.start(input, input.key);
        if (endpoint === "workflows/launch") result = quickLaunch(definitions, workflows, flow, runner, input);
        if (endpoint === "workflow-runs/action") result = flow.action(string(input.id, "run"), input.operation);
        if (endpoint === "workflow-runs/retry") {
          const node = string(input.node, "node");
          result = flow.retry(string(input.id, "run"), node, { mode: input.mode,
            restart: input.restart ? string(input.restart, "restart node") : node, note: input.note });
        }
        if (endpoint === "workflow-runs/approval") {
          result = await flow.decide(string(input.id, "run"), string(input.node, "node"), input.decision, input.reason);
        }
        if (endpoint === "workflow-delivery/approve") result = await delivery.approve(string(input.id, "run"), input.branch);
        if (endpoint === "workflow-delivery/pr") result = await delivery.createPR(string(input.id, "run"));
        if (endpoint === "workflow-delivery/ci") result = await delivery.checkCI(string(input.id, "run"));
        if (endpoint === "workflow-delivery/release") result = await delivery.approveRelease(string(input.id, "run"));
        if (endpoint === "workflow-delivery/staging") result = await staging.dispatch(string(input.id, "run"), input.environment);
        if (endpoint === "projects/archive") result = definitions.archive(string(input.id, "project"));
        if (endpoint === "definitions") result = definitions.saveDefinition(input);
        if (endpoint === "harness/apply") result = workflows.relinkHarness(input);
        if (endpoint === "harness/preview") result = await previewHarness(definitions, runner, input);
        if (endpoint === "harness/trial") result = await trials.start(string(input.project, "project"), input);
        if (endpoint === "harness/trial/cancel") result = trials.cancel(string(input.project, "project"), input.id);
        if (endpoint === "harness/trial/retry") result = trials.retry(string(input.project, "project"), input.id, input.side);
        if (endpoint === "definitions/remove") {
          definitions.remove(string(input.id, "definition"));
          result = { removed: true };
        }
        if (endpoint === "runs") result = loop.start(input, string(input.key, "idempotency key"));
        if (endpoint === "runs/action") result = loop.action(string(input.id, "run"), input.operation);
      }
      if (result === undefined) return reply(res, 404, { error: "Unknown engineering endpoint" });
      return reply(res, 200, result);
    } catch (error) {
      return reply(res, error.status ?? 500, { error: error.status ? error.message : "Engineering operation failed" });
    }
  }
  return route;
}

module.exports = { prefix, createEngineeringRoutes };
