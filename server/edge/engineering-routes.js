"use strict";

const { timingSafeEqual } = require("node:crypto");
const { secureRunner } = require("../engineering/runner");
const { integer, string } = require("../engineering/definitions");
const { problem } = require("../engineering/state");
const { listPresets, buildPreset } = require("../engineering/workflow-presets");
const { quickLaunch, loopLaunch } = require("../engineering/workflow-launch");
const { previewHarness } = require("../engineering/harness-preview");
const { projectContext } = require("../engineering/project-context");
const workflowLive = require("../engineering/workflow-live");
const { createObservationReads } = require("../application/observations");
const { createEngineeringServices, workflowLiveMap, workflowRunDetail } = require("../application/engineering-services");

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
  const initialize = createEngineeringServices({ directory, runner });
  async function route(req, res, url) {
    if (!authenticated(req, token)) return reply(res, 403, { error: "Engineering session is required" });
    try {
      const { definitions, workflows, runs, loop, flowRuns, flow, templates, tasks, stages, observability, delivery, budget, staging, trials, presetDefinitions, presetWorkflows, evaluation } = initialize();
      const endpoint = url.pathname.slice(prefix.length);
      const query = (key) => string(url.searchParams.get(key), key);
      const observations = createObservationReads({ definitions, flowRuns, evaluation, observability, projectContext, workflowLive });
      let result;
      if (req.method === "GET") {
        const observed = await observations.get(endpoint, url);
        if (observed) result = observed.value;
        else if (endpoint === "projects") result = definitions.projects();
        if (endpoint === "tasks") result = tasks.list(query("project"));
        if (endpoint === "sdlc-stages") result = stages.list(query("project"));
        if (endpoint === "workflow-live-map") result = workflowLiveMap({ observability, flowRuns });
        if (endpoint === "project-budget") result = { current: budget.get(query("project")) ?? null };
        if (endpoint === "workflows") result = workflows.list(query("project"));
        if (endpoint === "workflows/presets") result = listPresets();
        if (endpoint === "workflow-runs") result = flowRuns.list(query("project"));
        if (endpoint === "workflow-run") result = workflowRunDetail({ flowRuns, workflows, observability, delivery, staging }, observations, query("id"));
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
        if (endpoint === "independent-evaluation") result = await evaluation.post(input);
        if (endpoint === "runtime" && runner.prepare) {
          void runner.prepare(input.build === true);
          result = runner.status();
        }
        if (endpoint === "runtime/login" && runner.login) {
          runner.login(input.cancel === true);
          result = runner.status();
        }
        if (endpoint === "projects") result = await definitions.saveProject(input);
        if (endpoint === "projects/ensure") result = await definitions.ensureProject(input);
        if (endpoint === "teams") result = definitions.saveTeam(input.name);
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
        if (endpoint === "workflows/presets/all") result = presetWorkflows(string(input.project, "project"));
        if (endpoint === "workflows/presets/defaults") {
          result = presetDefinitions(input.scope === "personal" ? null : string(input.project, "project"));
        }
        if (endpoint === "workflows/import") {
          result = templates.import(string(input.project, "project"), input.template, input.name);
        }
        if (endpoint === "workflows/plan") result = workflows.executionPlan(string(input.project, "project"), input.payload,
          input.id ? string(input.id, "workflow") : undefined);
        if (endpoint === "workflow-runs") result = flow.start(input, input.key);
        if (endpoint === "workflows/launch") result = quickLaunch(definitions, workflows, flow, runner, input);
        if (endpoint === "workflows/launch-loop") result = loopLaunch(definitions, workflows, flow, runner, input);
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
        if (endpoint === "workflow-delivery/apply") result = await delivery.applyToFolder(string(input.id, "run"));
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
        // 새 단독 Loop 실행은 workflows/launch-loop 가 Workflow 로 만든다. 과거 run 이력은 조회·제어만 남긴다.
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
