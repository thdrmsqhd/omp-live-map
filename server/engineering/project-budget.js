"use strict";

const { integer } = require("./definitions");
const { problem } = require("./state");

function projectBudget(db) {
  const current = (project) => db.prepare("SELECT cap,days,updated FROM project_budget WHERE project=?").get(project);
  function committed(project, cutoff) {
    const loops = db.prepare(`SELECT COALESCE(SUM(CASE WHEN r.status IN ('queued','running','paused') OR
      r.status='interrupted' OR EXISTS (SELECT 1 FROM attempt a WHERE a.run=r.id AND a.status IN ('uncertain','error','cancelled'))
      THEN json_extract(v.payload,'$.budgetCents')
      ELSE (SELECT COALESCE(SUM(json_extract(a.outcome,'$.costCents')),0) FROM attempt a WHERE a.run=r.id) END),0) AS total
      FROM run r JOIN task t ON r.task=t.id JOIN definition_version v ON v.id=r.definition AND v.version=r.version
      WHERE t.project=? AND (r.created>=? OR r.status IN ('queued','running','paused'))`).get(project, cutoff).total;
    const workflows = db.prepare(`SELECT COALESCE(SUM(CASE WHEN r.status IN ('queued','running','paused','waiting_approval') OR
      r.status='interrupted' OR EXISTS (SELECT 1 FROM workflow_node n WHERE n.run=r.id AND
        (n.status IN ('interrupted','cancelled') OR json_extract(n.outcome,'$.interrupted')=1))
      THEN r.budget ELSE
        (SELECT COALESCE(SUM(json_extract(outcome,'$.costCents')),0) FROM workflow_node WHERE run=r.id) +
        (SELECT COALESCE(SUM(json_extract(outcome,'$.costCents')),0) FROM workflow_retry WHERE run=r.id)
      END),0) AS total FROM workflow_run r JOIN workflow w ON r.workflow=w.id
      WHERE w.project=? AND (r.created>=? OR r.status IN ('queued','running','paused','waiting_approval'))`).get(project, cutoff).total;
    return loops + workflows;
  }
  function get(project) {
    const rule = current(project);
    return rule ? { ...rule, committed: committed(project, Date.now() - rule.days * 86400000) } : null;
  }
  return {
    get,
    check(project, cents) {
      const rule = get(project);
      if (rule && cents > 0 && rule.committed + cents > rule.cap) {
        throw problem(409, "Project budget would be exceeded by this execution reservation");
      }
    },
    save(project, body) {
      if (!db.prepare("SELECT 1 FROM project WHERE id=? AND archived=0").get(project)) throw problem(404, "Active project not found");
      if (body.remove === true) db.prepare("DELETE FROM project_budget WHERE project=?").run(project);
      else db.prepare(`INSERT INTO project_budget VALUES (?,?,?,?) ON CONFLICT(project) DO UPDATE
        SET cap=excluded.cap,days=excluded.days,updated=excluded.updated`).run(project,
        integer(body.cap, "project budget in cents", 0, 1000000), integer(body.days, "rolling budget period", 1, 90), Date.now());
      return { current: get(project) };
    },
  };
}

module.exports = { projectBudget };
