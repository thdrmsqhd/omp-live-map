"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { event } = require("./catalog");
const { transaction } = require("../infrastructure/sqlite");
const { string, integer } = require("./definitions");
const { problem, redact } = require("./state");
const { sdlcTasks } = require("./sdlc-tasks");
const { projectBudget } = require("./project-budget");

function workflowRuns(db, catalog, workflows, tasks = sdlcTasks(db, catalog, workflows)) {
  const quota = projectBudget(db);
  function get(id) {
    const run = db.prepare(`SELECT r.*,w.project FROM workflow_run r
      JOIN workflow w ON r.workflow=w.id WHERE r.id=?`).get(id);
    if (!run) throw problem(404, "Workflow run not found");
    const { idempotency_key, request_hash, sdlc_instruction, ...publicRun } = run;
    return publicRun;
  }
  function setStatus(id, from, to, error = null) {
    const current = get(id);
    if (!from.includes(current.status)) throw problem(409, "Workflow run changed state");
    db.prepare("UPDATE workflow_run SET status=?,error=? WHERE id=?").run(to, error ? redact(error) : null, id);
    event(db, "workflow.run", { id, status: to });
    tasks.followRun(id, to);
  }
  function setNode(run, node, status, outcome) {
    db.prepare(`INSERT INTO workflow_node VALUES (?,?,?,?,?) ON CONFLICT(run,node)
      DO UPDATE SET status=excluded.status,outcome=excluded.outcome,updated=excluded.updated`)
      .run(run, node, status, JSON.stringify(outcome ?? null), Date.now());
    event(db, "workflow.node", { id: run, node, status });
  }
  function create(input, idempotencyKey, launch) {
    const task = input.task ? tasks.get(string(input.task, "task id")) : null;
    if (task) input = { ...input, project: task.project, workflow: task.workflow, version: task.workflow_version, title: task.title };
    const project = string(input.project, "project");
    const existingWorkflow = launch ? null : {
      id: string(input.workflow, "workflow"),
      version: integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER),
    };
    const title = string(input.title, "run title");
    const timeout = integer(input.timeoutMs, "workflow timeout", 100, 3600000);
    const budget = integer(input.budgetCents, "workflow budget", 0, 100000);
    const key = string(idempotencyKey, "idempotency key");
    const instruction = task?.instruction ?? (launch ? string(input.instruction, "run instruction", 12000) : null);
    const identity = launch ? ["quick", project, title, timeout, budget, instruction, launch.source] :
      [project, existingWorkflow.id, existingWorkflow.version, title, timeout, budget, task?.id ?? null, instruction];
    const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    return transaction(db, () => {
      const existing = db.prepare("SELECT id,request_hash FROM workflow_run WHERE idempotency_key=?").get(key);
      if (existing) {
        if (existing.request_hash !== hash) throw problem(409, "Idempotency key was used for a different workflow run");
        return { run: get(existing.id), created: false };
      }
      if (catalog.project(project).archived) throw problem(409, "Project is archived");
      if (task && tasks.get(task.id).status !== "ready") throw problem(409, "Development task must be Ready");
      quota.check(project, budget);
      const { id, version } = launch ? launch.prepare() : existingWorkflow;
      workflows.get(project, id, version);
      const run = randomUUID(), now = Date.now();
      db.prepare(`INSERT INTO workflow_run (id,workflow,version,title,status,created,deadline,budget,idempotency_key,request_hash,sdlc_task,sdlc_instruction)
        VALUES (?,?,?,?,'queued',?,?,?,?,?,?,?)`)
        .run(run, id, version, title, now, now + timeout, budget, key, hash, task?.id ?? null, instruction);
      tasks.followRun(run, "queued");
      event(db, "workflow.created", { id: run, project, workflow: id, version });
      return { run: get(run), created: true };
    });
  }
  function nodes(id) {
    return db.prepare("SELECT node,status,outcome,updated FROM workflow_node WHERE run=? ORDER BY updated,node").all(id)
      .map((item) => ({ ...item, outcome: JSON.parse(item.outcome ?? "null") }));
  }
  function updatePendingNode(id, node, status, outcome) {
    if (db.prepare("SELECT 1 FROM workflow_node WHERE run=? AND node=?").get(id, node)) {
      throw problem(409, "Workflow node already started");
    }
    setNode(id, node, status, outcome);
  }
  function retries(id) {
      return db.prepare("SELECT node,attempt,outcome,created FROM workflow_retry WHERE run=? ORDER BY created,node,attempt").all(id)
        .map((item) => ({ ...item, outcome: JSON.parse(item.outcome) }));
  }
  return {
    create, get, nodes,
    taskInstruction: (id) => db.prepare("SELECT sdlc_instruction FROM workflow_run WHERE id=?").get(id)?.sdlc_instruction ?? "",
    list(project) {
      return db.prepare(`SELECT r.id,r.title,r.status,r.created,r.workflow,r.version FROM workflow_run r JOIN workflow w
        ON r.workflow=w.id WHERE w.project=? ORDER BY r.created DESC,r.id LIMIT 100`).all(project);
    },
    change: (id, from, to, error) => transaction(db, () => setStatus(id, from, to, error)),
    workspace: (id, workspace) => db.prepare("UPDATE workflow_run SET workspace=? WHERE id=? AND workspace IS NULL").run(workspace, id),
    skip(id, skipped) {
      transaction(db, () => { for (const node of skipped) updatePendingNode(id, node, "skipped"); });
    },
    begin(id, node) {
      transaction(db, () => {
        if (get(id).status !== "running") throw problem(409, "Workflow is not running");
        updatePendingNode(id, node, "running");
      });
    },
    finish(id, node, status, outcome) {
      transaction(db, () => {
        const previous = db.prepare("SELECT status FROM workflow_node WHERE run=? AND node=?").get(id, node);
        if (previous?.status !== "running") throw problem(409, "Workflow node is not running");
        setNode(id, node, status, outcome);
      });
    },
    ask(id, node, prompt, artifacts, gate) {
      transaction(db, () => {
        setStatus(id, ["running"], "waiting_approval");
        updatePendingNode(id, node, "waiting_approval", { prompt, artifacts, ...(gate ? { gate } : {}) });
      });
    },
    hold(id, node, prompt, gate) {
      transaction(db, () => {
        setStatus(id, ["running"], "waiting_approval");
        updatePendingNode(id, node, "waiting_approval", { prompt, gate, hold: true, artifacts: [] });
      });
    },
    gateCleared(id, node) {
      return Boolean(db.prepare(`SELECT 1 FROM event WHERE kind='workflow.gate' AND json_extract(payload,'$.id')=?
        AND json_extract(payload,'$.node')=? AND json_extract(payload,'$.decision')='approved'`).get(id, node));
    },
    decide(id, node, decision, reason) {
      transaction(db, () => {
        const waiting = db.prepare("SELECT status,outcome FROM workflow_node WHERE run=? AND node=?").get(id, node);
        if (waiting?.status !== "waiting_approval") {
          throw problem(409, "Approval is not pending");
        }
        if (!["approved", "rejected"].includes(decision)) throw problem(400, "Invalid approval decision");
        const previous = JSON.parse(waiting.outcome ?? "null");
        setStatus(id, ["waiting_approval"], "queued");
        if (previous?.hold) {
          if (decision === "approved") {
            db.prepare("DELETE FROM workflow_node WHERE run=? AND node=?").run(id, node);
            event(db, "workflow.gate", { id, node, decision, gate: previous.gate });
            return;
          }
          setNode(id, node, "failed", { ...previous, port: "rejected", reason: "사용자가 수동 작업을 진행하지 않음" });
          return;
        }
        const explanation = (reason || decision === "rejected") ? string(reason, "approval reason", 2000) : "";
        setNode(id, node, "succeeded", { ...previous, port: decision, reason: redact(explanation) });
      });
    },
    retries,
    retryInstruction(id, node) {
      const row = db.prepare(`SELECT payload FROM event WHERE kind='workflow.retry' AND json_extract(payload,'$.id')=?
        AND json_extract(payload,'$.node')=? ORDER BY seq DESC LIMIT 1`).get(id, node);
      return row ? JSON.parse(row.payload) : null;
    },
    retry(id, node, descendants, { failed = node, mode = "retry", note = "" } = {}) {
      transaction(db, () => {
        const run = get(id);
        const history = nodes(id);
        const failure = history.find((item) => item.node === failed);
        if (run.status !== "failed" || failure?.status !== "failed" || failure.outcome?.interrupted ||
            failure.outcome?.passed !== false || run.deadline <= Date.now()) {
          throw problem(409, "Only a failed node with a known result and time remaining can be retried");
        }
        if (run.sdlc_task && db.prepare("SELECT id FROM workflow_run WHERE sdlc_task=? ORDER BY created DESC,rowid DESC LIMIT 1")
          .get(run.sdlc_task).id !== id) throw problem(409, "The task already has a newer workflow run");
        const used = [...history, ...retries(id)].reduce((total, item) => total + (item.outcome?.costCents ?? 0), 0);
        quota.check(run.project, Math.max(0, run.budget - used));
        const count = db.prepare("SELECT COUNT(*) AS n FROM workflow_retry WHERE run=? AND node=?");
        const archive = db.prepare("INSERT INTO workflow_retry VALUES (?,?,?,?,?)");
        if (count.get(id, node).n >= 3 || count.get(id, failed).n >= 3) throw problem(409, "Workflow node retry limit reached");
        const remove = db.prepare("DELETE FROM workflow_node WHERE run=? AND node=?");
        for (const item of history.filter((item) => item.node === node || descendants.has(item.node))) {
          if (item.status !== "skipped") archive.run(id, item.node, count.get(id, item.node).n + 1, JSON.stringify(item.outcome), Date.now());
          remove.run(id, item.node);
        }
        const lastAttempt = failure.outcome.attempts?.at(-1);
        const evidence = mode === "rework" ? redact(JSON.stringify({
          error: failure.outcome.error,
          checks: (failure.outcome.checks ?? lastAttempt?.checks ?? []).filter((check) => !check.passed),
          resultErrors: (failure.outcome.result ?? lastAttempt?.result)?.errors,
        })) : "";
        setStatus(id, ["failed"], "queued");
        event(db, "workflow.retry", { id, node, failed, mode, note: note ? redact(string(note, "rework note", 2000)) : "", evidence });
      });
    },
    recover() {
      transaction(db, () => {
        for (const { id } of db.prepare("SELECT id FROM workflow_run WHERE status IN ('queued','running')").all()) {
          for (const item of nodes(id).filter(({ status }) => status === "running")) setNode(id, item.node, "interrupted");
          setStatus(id, ["queued", "running"], "interrupted", "External execution must be checked before continuing.");
        }
      });
    },
  };
}

module.exports = { workflowRuns };
