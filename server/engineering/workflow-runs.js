"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { event } = require("./catalog");
const { transaction } = require("./database");
const { string, integer } = require("./definitions");
const { problem, redact } = require("./state");

function workflowRuns(db, catalog, workflows) {
  function get(id) {
    const run = db.prepare(`SELECT r.*,w.project FROM workflow_run r
      JOIN workflow w ON r.workflow=w.id WHERE r.id=?`).get(id);
    if (!run) throw problem(404, "Workflow run not found");
    const { idempotency_key, request_hash, ...publicRun } = run;
    return publicRun;
  }
  function setStatus(id, from, to, error = null) {
    const current = get(id);
    if (!from.includes(current.status)) throw problem(409, "Workflow run changed state");
    db.prepare("UPDATE workflow_run SET status=?,error=? WHERE id=?").run(to, error ? redact(error) : null, id);
    event(db, "workflow.run", { id, status: to });
  }
  function setNode(run, node, status, outcome) {
    db.prepare(`INSERT INTO workflow_node VALUES (?,?,?,?,?) ON CONFLICT(run,node)
      DO UPDATE SET status=excluded.status,outcome=excluded.outcome,updated=excluded.updated`)
      .run(run, node, status, JSON.stringify(outcome ?? null), Date.now());
    event(db, "workflow.node", { id: run, node, status });
  }
  function create(input, idempotencyKey) {
    const project = string(input.project, "project");
    const id = string(input.workflow, "workflow");
    const version = integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER);
    const title = string(input.title, "run title");
    const timeout = integer(input.timeoutMs, "workflow timeout", 100, 3600000);
    const budget = integer(input.budgetCents, "workflow budget", 0, 100000);
    const key = string(idempotencyKey, "idempotency key");
    const hash = createHash("sha256").update(JSON.stringify([project,id,version,title,timeout,budget])).digest("hex");
    return transaction(db, () => {
      const existing = db.prepare("SELECT id,request_hash FROM workflow_run WHERE idempotency_key=?").get(key);
      if (existing) {
        if (existing.request_hash !== hash) throw problem(409, "Idempotency key was used for a different workflow run");
        return { run: get(existing.id), created: false };
      }
      workflows.get(project, id, version);
      if (catalog.project(project).archived) throw problem(409, "Project is archived");
      const run = randomUUID(), now = Date.now();
      db.prepare("INSERT INTO workflow_run VALUES (?,?,?,?, 'queued',NULL,?,?,?,?,?,NULL)")
        .run(run, id, version, title, now, now + timeout, budget, key, hash);
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
  return {
    create, get, nodes,
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
    ask(id, node, prompt, artifacts) {
      transaction(db, () => {
        setStatus(id, ["running"], "waiting_approval");
        updatePendingNode(id, node, "waiting_approval", { prompt, artifacts });
      });
    },
    decide(id, node, decision, reason) {
      transaction(db, () => {
        const waiting = db.prepare("SELECT status,outcome FROM workflow_node WHERE run=? AND node=?").get(id, node);
        if (waiting?.status !== "waiting_approval") {
          throw problem(409, "Approval is not pending");
        }
        if (!["approved", "rejected"].includes(decision)) throw problem(400, "Invalid approval decision");
        setStatus(id, ["waiting_approval"], "queued");
        const explanation = (reason || decision === "rejected") ? string(reason, "approval reason", 2000) : "";
        const previous = JSON.parse(waiting.outcome ?? "null");
        setNode(id, node, "succeeded", { ...previous, port: decision, reason: redact(explanation) });
      });
    },
    retries(id) {
      return db.prepare("SELECT node,attempt,outcome,created FROM workflow_retry WHERE run=? ORDER BY created,node,attempt").all(id)
        .map((item) => ({ ...item, outcome: JSON.parse(item.outcome) }));
    },
    retry(id, node, descendants) {
      transaction(db, () => {
        const run = get(id);
        const history = nodes(id);
        const failed = history.find((item) => item.node === node);
        if (run.status !== "failed" || failed?.status !== "failed" || failed.outcome?.interrupted ||
            failed.outcome?.passed !== false || run.deadline <= Date.now()) {
          throw problem(409, "Only a failed node with a known result and time remaining can be retried");
        }
        if (history.some((item) => descendants.has(item.node) && item.status !== "skipped")) {
          throw problem(409, "A downstream node already executed; start a new workflow run");
        }
        const count = db.prepare("SELECT COUNT(*) AS n FROM workflow_retry WHERE run=? AND node=?").get(id, node).n;
        if (count >= 3) throw problem(409, "Workflow node retry limit reached");
        db.prepare("INSERT INTO workflow_retry VALUES (?,?,?,?,?)").run(id, node, count + 1, JSON.stringify(failed.outcome), Date.now());
        const remove = db.prepare("DELETE FROM workflow_node WHERE run=? AND node=?");
        remove.run(id, node);
        for (const child of descendants) remove.run(id, child);
        setStatus(id, ["failed"], "queued");
        event(db, "workflow.retry", { id, node, attempt: count + 1 });
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
