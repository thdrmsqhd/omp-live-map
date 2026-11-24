"use strict";

const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { event } = require("./catalog");
const { string, integer } = require("./definitions");
const { problem } = require("./state");

const progress = {
  queued: "running", running: "running", waiting_approval: "waiting_approval", paused: "blocked",
  interrupted: "blocked", failed: "blocked", cancelled: "blocked", limit_exceeded: "blocked", succeeded: "completed",
};

function sdlcTasks(db, catalog, workflows) {
  function get(id) {
    const row = db.prepare("SELECT * FROM sdlc_task WHERE id=?").get(id);
    if (!row) throw problem(404, "Development task not found");
    return row;
  }
  function list(project) {
    catalog.project(project);
    return db.prepare(`SELECT t.*,json_extract(v.payload,'$.name') AS workflow_name,
      (SELECT r.id FROM workflow_run r WHERE r.sdlc_task=t.id ORDER BY r.created DESC,r.rowid DESC LIMIT 1) AS latest_run
      FROM sdlc_task t JOIN workflow_version v ON v.workflow=t.workflow AND v.version=t.workflow_version
      WHERE t.project=? ORDER BY t.updated DESC,t.id`).all(project);
  }
  function editable(task) {
    if (db.prepare(`SELECT 1 FROM workflow_run WHERE sdlc_task=? AND status IN
      ('queued','running','waiting_approval','paused','interrupted')`).get(task.id)) {
      throw problem(409, "Finish or cancel the active workflow run before changing this task");
    }
  }
  function expectRevision(task, revision) {
    if (integer(revision, "task revision", 1, Number.MAX_SAFE_INTEGER) !== task.revision) {
      throw problem(409, "Development task changed. Reload it before saving.");
    }
  }
  function save(input) {
    const owner = string(input.project, "project");
    const title = string(input.title, "task title");
    const instruction = string(input.instruction, "task instruction", 12000);
    const version = integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER);
    return transaction(db, () => {
      if (catalog.project(owner).archived) throw problem(409, "Project is archived");
      const workflow = workflows.get(owner, string(input.workflow, "workflow"), version);
      const existing = input.id ? get(string(input.id, "task id")) : null;
      const id = existing?.id ?? randomUUID();
      if (existing) {
        if (existing.project !== owner) throw problem(409, "Task ownership is immutable");
        expectRevision(existing, input.revision);
        editable(existing);
        db.prepare(`UPDATE sdlc_task SET title=?,instruction=?,workflow=?,workflow_version=?,revision=revision+1,
          updated=? WHERE id=?`).run(title, instruction, workflow.id, workflow.version, Date.now(), id);
      } else db.prepare("INSERT INTO sdlc_task VALUES (?,?,?,?,'backlog',?,?,1,?)")
        .run(id, owner, title, instruction, workflow.id, workflow.version, Date.now());
      event(db, "sdlc.task.saved", { id, project: owner });
      return get(id);
    });
  }
  function move(id, status, revision) {
    if (!["ready", "backlog"].includes(status)) throw problem(400, "Task can be moved manually to Backlog or Ready");
    return transaction(db, () => {
      const task = get(id);
      if (catalog.project(task.project).archived) throw problem(409, "Project is archived");
      expectRevision(task, revision);
      editable(task);
      db.prepare("UPDATE sdlc_task SET status=?,revision=revision+1,updated=? WHERE id=?").run(status, Date.now(), id);
      event(db, "sdlc.task.status", { id, status });
      return get(id);
    });
  }
  function followRun(id, status) {
    const link = db.prepare("SELECT sdlc_task FROM workflow_run WHERE id=?").get(id)?.sdlc_task;
    if (!link || !progress[status]) return;
    const latest = db.prepare("SELECT id FROM workflow_run WHERE sdlc_task=? ORDER BY created DESC,rowid DESC LIMIT 1").get(link);
    if (latest.id !== id) return;
    db.prepare("UPDATE sdlc_task SET status=?,revision=revision+1,updated=? WHERE id=?").run(progress[status], Date.now(), link);
    event(db, "sdlc.task.status", { id: link, status: progress[status], run: id });
  }
  return { get, list, save, move, followRun };
}

module.exports = { sdlcTasks };
