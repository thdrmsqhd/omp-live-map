"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { artifactText } = require("./workflow-artifact");
const { git } = require("./catalog");
const { problem, redact } = require("./state");

function workflowObservability(db, runs, workspaceRoot) {
  async function ownedWorkspace(run) {
    const root = await fs.realpath(workspaceRoot);
    const workspace = await fs.realpath(run.workspace);
    if (path.dirname(workspace) !== root || path.basename(workspace) !== run.id) {
      throw problem(409, "Worktree does not belong to the workflow run");
    }
    return workspace;
  }
  async function artifact(id, node, file) {
    const run = runs.get(id);
    const outcome = runs.nodes(id).find((item) => item.node === node)?.outcome;
    const ref = outcome?.artifacts?.find(({ path }) => path === file);
    if (!ref || !run.workspace) throw problem(404, "This execution has no matching artifact");
    try {
      const { bytes } = await artifactText(await ownedWorkspace(run), ref, 32 * 1024);
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (decoded.includes("\0")) throw new Error("Binary artifact");
      return { path: file, text: redact(decoded), truncated: decoded.length > 8000 || decoded.split("\n").length > 100 };
    } catch {
      throw problem(409, "The artifact is changed, unavailable or not a previewable text file");
    }
  }
  async function review(id) {
    const run = runs.get(id);
    if (!run.workspace) return { status: "", diff: "" };
    const workspace = await ownedWorkspace(run);
    try {
      const [status, diff] = await Promise.all([
        git(workspace, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=normal"]),
        git(workspace, ["--no-optional-locks", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "HEAD", "--"]),
      ]);
      return { status: redact(status), diff: redact(diff), truncated: status.length > 8000 || diff.length > 8000 };
    } catch {
      throw problem(409, "Worktree changes could not be read within the review limit");
    }
  }
  function timeline(id) {
    return db.prepare(`SELECT seq,created,kind,payload FROM event WHERE kind LIKE 'workflow.%'
      AND json_extract(payload,'$.id')=? ORDER BY seq DESC LIMIT 100`).all(id).reverse()
      .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  function approvals(project) {
    return db.prepare(`SELECT r.id AS run,r.title,n.node,n.updated,n.outcome FROM workflow_node n
      JOIN workflow_run r ON r.id=n.run JOIN workflow w ON w.id=r.workflow
      WHERE w.project=? AND r.status='waiting_approval' AND n.status='waiting_approval'
      ORDER BY n.updated,n.node`).all(project).map(({ outcome, ...row }) => ({ ...row, ...JSON.parse(outcome ?? "null") }));
  }
  function liveMapRuns() {
    const activeRuns = `FROM workflow_run r JOIN workflow w ON w.id=r.workflow
      JOIN project p ON p.id=w.project WHERE p.archived=0`;
    const attention = db.prepare(`SELECT r.id,r.title,r.status,p.name AS project,
      (SELECT n.node FROM workflow_node n WHERE n.run=r.id AND n.status=r.status
        ORDER BY n.updated DESC,n.node LIMIT 1) AS node, COUNT(*) OVER () AS total
      ${activeRuns} AND r.status IN ('waiting_approval','failed','interrupted')
      ORDER BY CASE r.status WHEN 'waiting_approval' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
        r.created DESC,r.id LIMIT 100`).all();
    const recent = db.prepare(`SELECT r.id,r.title,r.status,p.name AS project ${activeRuns}
      AND r.status NOT IN ('waiting_approval','failed','interrupted')
      ORDER BY CASE WHEN r.status IN ('running','queued') THEN 0 ELSE 1 END,
        r.created DESC,r.id LIMIT 20`).all();
    return { total: attention[0]?.total ?? 0, attention: attention.map(({ total, ...item }) => item), recent };
  }
  function dashboard(project, days = 30) {
    const cutoff = Date.now() - days * 86400000;
    const states = db.prepare(`SELECT r.status,COUNT(*) AS count FROM workflow_run r
      JOIN workflow w ON w.id=r.workflow WHERE w.project=? AND r.created>=? GROUP BY r.status`).all(project, cutoff);
    const measures = db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(r.status='succeeded'),0) AS completed,
      COALESCE(SUM((SELECT COUNT(*) FROM workflow_retry WHERE run=r.id)),0) AS retries,
      COALESCE(SUM((SELECT COUNT(*) FROM workflow_node WHERE run=r.id AND json_extract(outcome,'$.port') IN ('approved','rejected'))),0) AS decisions,
      AVG(CASE WHEN r.status='succeeded' THEN (SELECT MAX(updated) FROM workflow_node WHERE run=r.id)-r.created END) AS averageMs
      FROM workflow_run r JOIN workflow w ON w.id=r.workflow WHERE w.project=? AND r.created>=?`).get(project, cutoff);
    const usage = db.prepare(`WITH agent_usage(cost, basis, model, agent) AS (
      SELECT json_extract(a.outcome,'$.costCents'),json_extract(a.outcome,'$.costBasis'),json_extract(a.outcome,'$.model'),
        json_extract(a.outcome,'$.agent') FROM attempt a
        JOIN run r ON r.id=a.run JOIN task t ON t.id=r.task WHERE t.project=? AND a.started>=?
      UNION ALL
      SELECT json_extract(a.value,'$.costCents'),json_extract(a.value,'$.costBasis'),json_extract(a.value,'$.model'),
        json_extract(a.value,'$.agent') FROM
        (SELECT run,outcome,updated AS timestamp FROM workflow_node UNION ALL SELECT run,outcome,created AS timestamp FROM workflow_retry) result
        JOIN workflow_run r ON r.id=result.run JOIN workflow w ON w.id=r.workflow,
        json_each(result.outcome,'$.attempts') a WHERE w.project=? AND result.timestamp>=?
    ), normalized AS (
      SELECT cost, model, agent, CASE WHEN cost IS NULL THEN 'missing' WHEN basis='reserved' THEN 'reserved'
        WHEN basis='reported' THEN 'reported' ELSE 'unknown_basis' END AS category FROM agent_usage
    )
    SELECT category,model,agent,COUNT(*) AS count,SUM(cost) AS costCents FROM normalized GROUP BY category,model,agent`)
      .all(project, cutoff, project, cutoff);
    return { states, measures, usage };
  }
  return { approvals, artifact, dashboard, liveMapRuns, review, timeline };
}

module.exports = { workflowObservability };
