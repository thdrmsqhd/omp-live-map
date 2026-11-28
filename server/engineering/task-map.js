"use strict";

// 한 맵(프로젝트 띠 > Task > Workflow 단계 > 세션)을 그리는 데 필요한 것을 프로젝트마다 한 번에 준다.
//  - 단계: Task 가 고정한 Workflow 버전의 실행 순서(compileGraph order)에서 Start·End 를 뺀 노드. 하네스·루프는 칩으로 쓴다.
//  - 상태: Task 의 최근 실행(latest_run)의 workflow_node 행. 아직 돌지 않은 단계는 'pending'.
//  - 세션: 단계 실행 결과(outcome.attempts[].sessionId)와 재시도 보관(workflow_retry), 실행 중이면 진행 상태(live.sessionId).
//    화면은 이 sessionId 를 스냅샷 노드의 sid(omp 세션 머리 id · Claude 기록 파일 이름)와 맞춰 실제 세션 카드를 단계 아래에 잇는다.
const { compileGraph } = require("./graph-definition");
const { isTaskLocalName } = require("./task-local");
const { legacyWorkspace } = require("./legacy-worktrees");

const TEXT = 600;
const clip = (value, size = TEXT) => typeof value === "string" ? value.slice(0, size) : undefined;

// node → [{ sessionId, attempt, retry, agent, model, costCents, live }] (같은 세션은 한 번만)
function stageSessions(nodes = [], retries = [], live = {}) {
  const out = new Map();
  const add = (node, entry) => {
    if (typeof entry.sessionId !== "string" || !entry.sessionId) return;
    const list = out.get(node) ?? [];
    if (list.some(({ sessionId }) => sessionId === entry.sessionId)) return;
    list.push(entry);
    out.set(node, list);
  };
  const fromOutcome = (node, outcome, retry) => {
    for (const [index, attempt] of (Array.isArray(outcome?.attempts) ? outcome.attempts : []).entries()) {
      add(node, { sessionId: attempt?.sessionId, attempt: index + 1, retry, agent: attempt?.agent ?? null,
        model: attempt?.model ?? null, costCents: Number.isFinite(attempt?.costCents) ? attempt.costCents : null, live: false });
    }
  };
  for (const row of retries) fromOutcome(row.node, row.outcome, row.attempt);
  for (const row of nodes) fromOutcome(row.node, row.outcome, 0);
  for (const [node, state] of Object.entries(live ?? {})) {
    if (state?.sessionId) add(node, { sessionId: state.sessionId, attempt: state.attempt || 1, retry: 0, agent: null, model: null, costCents: null, live: true });
  }
  return out;
}

function taskMap({ definitions, workflows, tasks, flowRuns, workflowLive }, project) {
  const owner = definitions.project(project);
  const cache = new Map();
  const version = (id, number) => {
    const key = id + "@" + (number ?? "");
    if (!cache.has(key)) {
      try { cache.set(key, definitions.versionOf(id, number)); } catch { cache.set(key, null); }
    }
    return cache.get(key);
  };
  const harnessChip = (row) => {
    if (!row) return null;
    const model = version(row.payload.model);
    return { id: row.id, version: row.version, name: row.name, scope: row.scope, adapter: row.payload.adapter,
      role: clip(row.payload.role, 240), instructions: clip(row.payload.instructions, 4000),
      model: model ? { id: model.id, name: model.name, model: model.payload.model } : null };
  };
  const loopChip = (row) => row && { id: row.id, version: row.version, name: row.name, scope: row.scope,
    attempts: row.payload.attempts, timeoutMs: row.payload.timeoutMs, budgetCents: row.payload.budgetCents,
    checks: row.payload.checks.map(({ command, args, code }) => ({ command, args: [...args], code })) };
  function stagesOf(payload) {
    let order;
    try { order = compileGraph(payload).order; } catch { order = payload.nodes.map(({ id }) => id); }
    const byId = new Map(payload.nodes.map((node) => [node.id, node]));
    return order.map((id) => byId.get(id)).filter((node) => node && node.type !== "start" && node.type !== "end").map((node) => {
      const stage = { id: node.id, type: node.type, label: node.label, instruction: clip(node.instruction, 4000),
        prompt: clip(node.prompt, 2000), check: node.check ? { command: node.check.command, args: [...node.check.args] } : undefined };
      if (node.type === "agent" && node.definition) stage.harness = harnessChip(version(node.definition, node.version));
      if (node.type === "loop" && node.definition) {
        const loop = version(node.definition, node.version);
        stage.loop = loopChip(loop);
        if (loop) stage.harness = harnessChip(definitions.dependency(loop));
      }
      return stage;
    });
  }
  const rows = tasks.list(project).map((task) => {
    let flow = null;
    try { flow = workflows.get(project, task.workflow, task.workflow_version); } catch { /* 지워진 Workflow */ }
    const stages = flow ? stagesOf(flow.payload) : [];
    let run = null;
    if (task.latest_run) {
      const detail = flowRuns.get(task.latest_run);
      const nodes = flowRuns.nodes(detail.id), retries = flowRuns.retries(detail.id), live = workflowLive.snapshot(detail.id);
      const sessions = stageSessions(nodes, retries, live);
      const byNode = new Map(nodes.map((row) => [row.node, row]));
      let cost = 0;
      for (const row of [...nodes, ...retries]) for (const attempt of row.outcome?.attempts ?? []) cost += Number(attempt?.costCents) || 0;
      for (const stage of stages) {
        const row = byNode.get(stage.id);
        stage.status = row?.status ?? "pending";
        stage.sessions = sessions.get(stage.id) ?? [];
        if (row?.status === "waiting_approval") stage.waiting = { prompt: clip(row.outcome?.prompt, 2000) ?? stage.prompt ?? "", gate: row.outcome?.gate ?? null };
        if (row?.outcome?.error) stage.error = clip(row.outcome.error, 600);
        if (live[stage.id]) stage.live = { phase: live[stage.id].phase, attempt: live[stage.id].attempt, attempts: live[stage.id].attempts,
          tool: live[stage.id].tool, text: clip(live[stage.id].text, 800), askSession: live[stage.id].askSession };
      }
      run = { id: detail.id, status: detail.status, created: detail.created, error: clip(detail.error, 600),
        version: detail.version, workflow: detail.workflow, costCents: Math.round(cost * 100) / 100,
        ...(legacyWorkspace(detail.workspace) ? { legacy: true } : {}),
        updated: Math.max(detail.created, ...nodes.map(({ updated }) => updated)) };
    } else for (const stage of stages) { stage.status = "pending"; stage.sessions = []; }
    return { id: task.id, title: task.title, instruction: task.instruction, status: task.status, revision: task.revision,
      updated: task.updated, timeoutMs: task.timeoutMs, budgetCents: task.budgetCents, timeoutSet: task.timeout_ms !== null, budgetSet: task.budget_cents !== null,
      workflow: flow ? { id: flow.id, version: flow.version, name: flow.name, scope: flow.scope, local: isTaskLocalName(flow.name, task.id) } : null,
      stages, run };
  });
  return { project: { id: owner.id, name: owner.name, root: owner.root, branch: owner.branch, archived: Boolean(owner.archived) }, tasks: rows };
}

module.exports = { taskMap, stageSessions };
