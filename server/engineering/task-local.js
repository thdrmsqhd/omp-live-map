"use strict";

// 맵의 서랍에서 단계·하네스·루프를 고칠 때의 저장 범위.
//  - '이 Task만'(기본): Task 가 쓰는 Workflow 의 사본(프로젝트 범위, 이름 끝 ' · Task <id 8자>')을 만들어 Task 를 그 사본에 고정한다.
//    하네스·루프를 고치면 정의도 같은 범위(원본과 같은 개인·팀·프로젝트)에 같은 꼬리 이름으로 사본을 만든다. 이미 사본이면 새 버전만 쓴다.
//  - '템플릿': 원본 Workflow·정의의 새 버전을 쓰고 Task 를 그 버전에 다시 고정한다(그 템플릿을 쓰는 다른 Task 는 고정 버전을 그대로 쓴다).
// Workflow 편집(단계 넣기·순서 바꾸기·지우기)은 줄 하나로 이어진 Workflow 만 다룬다(분기·병렬은 순서를 정할 수 없다).
const { transaction } = require("../infrastructure/sqlite");
const { string } = require("./definitions");
const { problem } = require("./state");

const suffix = (taskId) => " · Task " + String(taskId).slice(0, 8);
const isTaskLocalName = (name, taskId) => typeof name === "string" && name.endsWith(suffix(taskId));
const baseName = (name) => String(name).replace(/ · Task [0-9a-f-]{8}$/, "");
const LINEAR = new Set(["agent", "loop", "command", "approval", "subgraph"]);

function taskLocal(db, { definitions, workflows, tasks }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  // 정의 한 개를 범위에 맞게 쓴다. base 는 지금 단계가 고정한 버전, changes 는 고칠 칸.
  function writeDefinition(task, scope, base, changes, referenceVersion) {
    const latest = definitions.versionOf(base.id);
    const owner = { scope: latest.scope, project: latest.project ?? undefined, team: latest.team ?? undefined, kind: latest.kind, referenceVersion };
    if (scope === "template" || isTaskLocalName(latest.name, task.id)) {
      return definitions.writeDefinition({ ...owner, id: latest.id, version: latest.version, payload: { ...latest.payload, ...changes, name: latest.name } });
    }
    const name = baseName(latest.name).slice(0, 220) + suffix(task.id);
    const copy = db.prepare("SELECT id FROM definition WHERE scope=? AND project IS ? AND team IS ? AND kind=? AND name=?")
      .get(latest.scope, latest.project ?? null, latest.team ?? null, latest.kind, name);
    if (copy) {
      const current = definitions.versionOf(copy.id);
      return definitions.writeDefinition({ ...owner, id: current.id, version: current.version, payload: { ...base.payload, ...changes, name } });
    }
    return definitions.writeDefinition({ ...owner, payload: { ...base.payload, ...changes, name } });
  }
  // Workflow 문서를 범위에 맞게 저장하고 Task 를 그 버전에 고정한다.
  function saveFlow(task, scope, flow, payload) {
    let saved;
    if (scope === "template" || isTaskLocalName(flow.name, task.id)) {
      const latest = workflows.get(task.project, flow.id);
      saved = workflows.save({ project: task.project, id: latest.id, version: latest.version, payload: { ...payload, name: latest.name } });
    } else {
      const name = baseName(flow.name).slice(0, 220) + suffix(task.id);
      const copy = db.prepare("SELECT id FROM workflow WHERE scope='project' AND project=? AND name=?").get(task.project, name);
      const latest = copy && workflows.get(task.project, copy.id);
      saved = workflows.save({ project: task.project, ...(latest ? { id: latest.id, version: latest.version } : { scope: "project" }), payload: { ...payload, name } });
    }
    const current = tasks.get(task.id);
    const pinned = tasks.save({ project: task.project, id: task.id, revision: current.revision, workflow: saved.id, version: saved.version });
    return { task: pinned, workflow: { id: saved.id, version: saved.version, name: saved.name, local: isTaskLocalName(saved.name, task.id) }, scope };
  }
  function start(input) {
    const task = tasks.get(string(input.task, "task"));
    const scope = input.scope === "template" ? "template" : "task";
    // 템플릿을 고치면 최신 버전 위에 쓴다. 이 Task 만이면 Task 가 고정한 버전에서 사본을 만든다.
    const pinned = workflows.get(task.project, task.workflow, task.workflow_version);
    const flow = scope === "template" && !isTaskLocalName(pinned.name, task.id) ? workflows.get(task.project, task.workflow) : pinned;
    return { task, scope, flow, payload: clone(flow.payload) };
  }

  // { task, node, scope, stage?: {label,instruction,prompt,check}, harness?: {role,instructions,model}, loop?: {attempts,timeoutMs,budgetCents,checks} }
  function editStage(input) {
    return transaction(db, () => {
      const { task, scope, flow, payload } = start(input);
      const node = payload.nodes.find(({ id }) => id === string(input.node, "node"));
      if (!node || node.type === "start" || node.type === "end") throw problem(404, "Workflow stage not found");
      const stage = input.stage ?? {};
      if (stage.label !== undefined) node.label = string(stage.label, "stage label");
      if (stage.instruction !== undefined && (node.type === "agent" || node.type === "loop")) node.instruction = string(stage.instruction, "stage instruction", 12000);
      if (stage.prompt !== undefined && node.type === "approval") node.prompt = string(stage.prompt, "approval prompt", 2000);
      if (stage.check !== undefined && node.type === "command") node.check = stage.check;
      let loopRow = node.type === "loop" ? definitions.versionOf(node.definition, node.version) : null;
      if (input.harness) {
        const current = node.type === "loop" ? definitions.dependency(loopRow) : node.type === "agent" ? definitions.versionOf(node.definition, node.version) : null;
        if (!current) throw problem(400, "This stage has no harness");
        const changes = {};
        for (const key of ["role", "instructions", "model"]) if (input.harness[key] !== undefined) changes[key] = input.harness[key];
        const harness = writeDefinition(task, scope, current, changes);
        if (node.type === "agent") { node.definition = harness.id; node.version = harness.version; }
        else {
          loopRow = writeDefinition(task, scope, loopRow, { harness: harness.id }, harness.version);
          node.definition = loopRow.id; node.version = loopRow.version;
        }
      }
      if (input.loop) {
        if (node.type !== "loop") throw problem(400, "This stage has no loop");
        const changes = {};
        for (const key of ["attempts", "timeoutMs", "budgetCents", "checks"]) if (input.loop[key] !== undefined) changes[key] = input.loop[key];
        const harness = definitions.dependency(loopRow);
        loopRow = writeDefinition(task, scope, loopRow, changes, harness?.version);
        node.definition = loopRow.id; node.version = loopRow.version;
      }
      return saveFlow(task, scope, flow, payload);
    });
  }

  // { task, scope, stages: [{ id } | { id, type, label, definition, instruction, prompt }] } — 새 순서대로 한 줄로 다시 잇는다.
  function editWorkflow(input) {
    return transaction(db, () => {
      const { task, scope, flow, payload } = start(input);
      if (!Array.isArray(input.stages) || input.stages.length > 60) throw problem(400, "Invalid stage list");
      const start0 = payload.nodes.find(({ type }) => type === "start"), end0 = payload.nodes.find(({ type }) => type === "end");
      const existing = new Map(payload.nodes.map((node) => [node.id, node]));
      if (payload.nodes.some(({ type }) => !LINEAR.has(type) && type !== "start" && type !== "end")) {
        throw problem(409, "분기·병렬이 있는 Workflow 는 맵에서 단계 순서를 바꿀 수 없습니다.");
      }
      const stages = input.stages.map((item) => {
        const id = string(item?.id, "stage id", 64);
        if (existing.has(id)) return clone(existing.get(id));
        const type = item.type === "approval" ? "approval" : "agent";
        return type === "approval" ? { id, type, label: string(item.label ?? "승인", "stage label"), prompt: string(item.prompt ?? "결과를 확인해 주세요.", "approval prompt", 2000) }
          : { id, type, label: string(item.label ?? "새 단계", "stage label"), definition: string(item.definition, "harness"),
            instruction: string(item.instruction ?? "이 단계에서 할 일을 적어 주세요.", "stage instruction", 12000) };
      });
      if (new Set(stages.map(({ id }) => id)).size !== stages.length) throw problem(400, "Duplicate stage id");
      // 앞 단계 산출물을 받는 입력만 남긴다(지우거나 뒤로 옮긴 단계의 산출물은 더 받을 수 없다).
      const produced = new Map();
      for (const node of stages) {
        if (node.inputs) node.inputs = node.inputs.filter(({ source, artifact }) => produced.get(source)?.has(artifact));
        if (node.type === "condition") delete node.source;
        produced.set(node.id, new Set((node.outputs ?? []).map(({ name }) => name)));
      }
      const nodes = [start0, ...stages, end0].map((node, index) => ({ ...node, x: 35 + index * 160, y: 90 }));
      const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id, port: nodes[index].type === "approval" ? "approved" : "next" }));
      return saveFlow(task, scope, flow, { name: payload.name, nodes, edges });
    });
  }

  // 라이브러리의 Workflow 지우기: 아무 Task·실행·하위 Workflow 도 쓰지 않을 때만.
  function removeWorkflow(project, id) {
    return transaction(db, () => {
      const flow = workflows.get(string(project, "project"), string(id, "workflow"));
      if (db.prepare("SELECT 1 FROM sdlc_task WHERE workflow=? UNION ALL SELECT 1 FROM workflow_run WHERE workflow=? LIMIT 1").get(flow.id, flow.id)
        || db.prepare("SELECT 1 FROM workflow_subgraph WHERE target=? LIMIT 1").get(flow.id)) {
        throw problem(409, "이 Workflow 를 쓰는 Task 나 실행 기록이 있어 지울 수 없습니다.");
      }
      db.prepare("DELETE FROM workflow WHERE id=?").run(flow.id);
      return { removed: true };
    });
  }
  return { editStage, editWorkflow, removeWorkflow };
}

module.exports = { taskLocal, isTaskLocalName, taskSuffix: suffix };
