"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { git } = require("./catalog");
const { problem, redact } = require("./state");

function workflowObservability(db, runs, workspaceRoot) {
  async function review(id) {
    const run = runs.get(id);
    if (!run.workspace) return { status: "", diff: "" };
    const root = await fs.realpath(workspaceRoot);
    const workspace = await fs.realpath(run.workspace);
    if (path.dirname(workspace) !== root || path.basename(workspace) !== id) {
      throw problem(409, "Worktree does not belong to the workflow run");
    }
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
  function dashboard(project) {
    const states = db.prepare(`SELECT r.status,COUNT(*) AS count FROM workflow_run r
      JOIN workflow w ON w.id=r.workflow WHERE w.project=? GROUP BY r.status`).all(project);
    const usage = db.prepare(`WITH agent_usage(cost, basis) AS (
      SELECT json_extract(a.outcome,'$.costCents'),json_extract(a.outcome,'$.costBasis') FROM attempt a
        JOIN run r ON r.id=a.run JOIN task t ON t.id=r.task WHERE t.project=?
      UNION ALL
      SELECT json_extract(a.value,'$.costCents'),json_extract(a.value,'$.costBasis') FROM
        (SELECT run,outcome FROM workflow_node UNION ALL SELECT run,outcome FROM workflow_retry) result
        JOIN workflow_run r ON r.id=result.run JOIN workflow w ON w.id=r.workflow,
        json_each(result.outcome,'$.attempts') a WHERE w.project=?
    ), normalized AS (
      SELECT cost, CASE WHEN cost IS NULL THEN 'missing' WHEN basis='reserved' THEN 'reserved'
        WHEN basis='reported' THEN 'reported' ELSE 'unknown_basis' END AS category FROM agent_usage
    )
    SELECT category,COUNT(*) AS count,SUM(cost) AS costCents FROM normalized GROUP BY category`).all(project, project);
    return { states, usage };
  }
  return { approvals, dashboard, review, timeline };
}

module.exports = { workflowObservability };
