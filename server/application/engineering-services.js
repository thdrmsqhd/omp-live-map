"use strict";

const path = require("node:path");
const { openDatabase } = require("../infrastructure/sqlite");
const { catalog } = require("../engineering/catalog");
const { workflowCatalog } = require("../engineering/workflow-catalog");
const { workflowRuns } = require("../engineering/workflow-runs");
const { workflowEngine } = require("../engineering/workflow-engine");
const { workflowTemplates } = require("../engineering/workflow-templates");
const { sdlcTasks } = require("../engineering/sdlc-tasks");
const { sdlcStages } = require("../engineering/sdlc-stages");
const { workflowObservability } = require("../engineering/workflow-observability");
const { independentEvaluation } = require("../engineering/independent-evaluation");
const { workflowDelivery } = require("../engineering/workflow-delivery");
const { retryOptions } = require("../engineering/workflow-retry-plan");
const { addPresetDefinitions, addPresetWorkflows } = require("../engineering/workflow-presets");
const { projectBudget } = require("../engineering/project-budget");
const { workflowStaging } = require("../engineering/workflow-staging");
const { runStore } = require("../engineering/run-store");
const { taskLocal } = require("../engineering/task-local");
const { loopEngine } = require("../engineering/loop");
const { secureRunner } = require("../engineering/runner");
const { workFolders } = require("../engineering/work-folder");
const { harnessTrials } = require("../engineering/harness-trials");
const workflowLive = require("../engineering/workflow-live");
const shadowRepo = require("../engineering/shadow-repo");
const { mergeProfilesIntoHarnesses } = require("../engineering/harness-merge");
const sessionHarness = require("../harness/session-harness");
const { cleanLegacyWorktrees, legacyWorkspace } = require("../engineering/legacy-worktrees");


function createEngineeringServices({ directory, runner = secureRunner() }) {
  let services, opened;
  function initialize() {
    if (services) return services;
    workflowLive.configure({ directory: path.resolve(directory) });
    shadowRepo.configure(path.resolve(directory, "shadow"));
    const db = openDatabase(path.resolve(directory, "engineering.sqlite"));
    opened = db;
    try {
      const definitions = catalog(db);
      // 예전 에이전트 프로필은 하네스로 합친다(한 번만). 세션 배정(assignments)은 session-harness.sqlite 에 남는다.
      mergeProfilesIntoHarnesses(db, definitions, sessionHarness.legacyRows());
      const runs = runStore(db, definitions);
      const workflows = workflowCatalog(db, definitions);
      const stages = sdlcStages(db, definitions);
      const tasks = sdlcTasks(db, definitions, workflows, stages);
      const flowRuns = workflowRuns(db, definitions, workflows, tasks);
      // 실행은 고른 작업 폴더(project.root)에서 바로 한다.
      const workspace = workFolders();
      const delivery = workflowDelivery(db, flowRuns, definitions);
      runs.recover();
      flowRuns.recover();
      const budget = projectBudget(db);
      // 예전 격리 작업 폴더(worktrees/<uuid>)가 남아 있으면 한 번 정리한다(등록된 프로젝트 저장소의 worktree 만).
      cleanLegacyWorktrees({ directory: path.resolve(directory), projects: definitions.projects(),
        log: (line) => console.log("[engineering] " + line) }).catch((error) => console.warn("[engineering] 이전 작업 폴더 정리 실패: " + error.message));
      services = { definitions, workflows, runs, flowRuns, tasks, budget, trials: harnessTrials(definitions, runner, workspace, budget),
        presetDefinitions: (project) => addPresetDefinitions(db, definitions, project),
        presetWorkflows: (project) => addPresetWorkflows(db, definitions, workflows, project),
        stages, taskEdits: taskLocal(db, { definitions, workflows, tasks }),
        observability: workflowObservability(db, flowRuns, definitions),
        evaluation: independentEvaluation({ db, directory, runs: flowRuns, definitions, workflows }),
        delivery, staging: workflowStaging(db, delivery),
        templates: workflowTemplates(definitions, workflows),
        flow: workflowEngine(flowRuns, workflows, definitions, runner, workspace),
        loop: loopEngine(runs, definitions, runner, workspace) };
      return services;
    } catch (error) {
      db.close();
      opened = undefined;
      throw error;
    }
  }
  // 테스트·종료 때 SQLite 를 닫는다(Windows 는 열린 파일을 지우지 못한다). 다음 요청은 다시 연다.
  initialize.close = () => {
    opened?.close();
    opened = undefined;
    services = undefined;
  };
  return initialize;
}
function workflowLiveMap({ observability, flowRuns }) {
  const result = observability.liveMapRuns();
  // '개입 필요' 함에서 바로 승인·반려할 수 있게 승인 단계의 안내 문구를 붙인다.
  for (const item of result.attention) {
    if (item.status !== "waiting_approval" || !item.node) continue;
    try {
      const outcome = flowRuns.nodes(item.id).find(({ node }) => node === item.node)?.outcome;
      if (typeof outcome?.prompt === "string") item.prompt = outcome.prompt.slice(0, 1200);
      if (outcome?.gate) item.gate = outcome.gate;
    } catch { /* 안내가 없어도 목록은 보여 준다 */ }
  }
  return result;
}
function workflowRunDetail({ flowRuns, workflows, observability, delivery, staging }, observations, id) {
  const run = flowRuns.get(id);
  const workflow = workflows.get(run.project, run.workflow, run.version);
  const { document: graph, display } = workflows.executionPlan(run.project, workflow.payload, run.workflow);
  const nodes = flowRuns.nodes(id);
  return { run, legacy: legacyWorkspace(run.workspace), nodes, interventions: run.status === "failed" ? retryOptions(graph, nodes) : {}, retries: flowRuns.retries(id), timeline: observability.timeline(id),
    delivery: delivery.get(id), staging: staging.get(id),
    labels: Object.fromEntries(graph.nodes.map(({ id, label }) => [id, label])),
    // 관제 화면이 단계 안에서 어떤 프롬프트가 어떤 정의로 실행되는지 보여 주는 데 쓴다.
    graph: { name: display.name, nodes: display.nodes.map(({ id, label, type, x, y, definition, version, instruction, prompt, check, workflow, gate }) => ({
      id, label, type, x, y, definition, version, workflow, gate,
      instruction: typeof instruction === "string" ? instruction.slice(0, 600) : undefined,
      prompt: typeof prompt === "string" ? prompt.slice(0, 600) : undefined,
      check: check ? { command: check.command, args: check.args } : undefined })),
      edges: display.edges },
    live: observations.live(id) };
}
module.exports = { createEngineeringServices, workflowLiveMap, workflowRunDetail };
