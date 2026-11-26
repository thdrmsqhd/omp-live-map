"use strict";

const { transaction } = require("../infrastructure/sqlite");
const { event } = require("./catalog");
const { integer, string } = require("./definitions");
const { problem } = require("./state");

const defaults = [
  ["backlog", "Backlog"], ["ready", "준비"], ["running", "진행 중"], ["waiting_approval", "승인 대기"],
  ["blocked", "보류"], ["completed", "완료"],
];

function sdlcStages(db, catalog, workflows) {
  function list(project) {
    catalog.project(project);
    const configured = new Map(db.prepare("SELECT * FROM sdlc_stage WHERE project=?").all(project)
      .map((row) => [row.status, row]));
    return defaults.map(([status, label], position) => configured.get(status) ??
      { project, status, label, position, workflow: null, workflow_version: null })
      .sort((a, b) => a.position - b.position || defaults.findIndex(([status]) => status === a.status)
        - defaults.findIndex(([status]) => status === b.status));
  }

  function save(input) {
    const project = string(input.project, "project");
    const status = string(input.status, "stage");
    if (!defaults.some(([key]) => key === status)) throw problem(400, "Unknown stage");
    const label = string(input.label, "stage label", 64);
    const position = integer(input.position, "stage position", 0, 20);
    return transaction(db, () => {
      if (catalog.project(project).archived) throw problem(409, "Project is archived");
      const workflow = input.workflow ? workflows.get(project, string(input.workflow, "workflow"),
        integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER)) : null;
      db.prepare(`INSERT INTO sdlc_stage VALUES (?,?,?,?,?,?) ON CONFLICT(project,status) DO UPDATE SET
        label=excluded.label,position=excluded.position,workflow=excluded.workflow,workflow_version=excluded.workflow_version`)
        .run(project, status, label, position, workflow?.id ?? null, workflow?.version ?? null);
      event(db, "sdlc.stage.saved", { project, status });
      return list(project);
    });
  }
  return { list, save };
}

module.exports = { sdlcStages };
