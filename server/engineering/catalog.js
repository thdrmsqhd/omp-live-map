"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { transaction } = require("../infrastructure/sqlite");
const { string, integer, definition } = require("./definitions");
const { problem } = require("./state");
const launch = promisify(execFile);

async function git(cwd, args) {
  const { stdout } = await launch("git", args, { cwd, timeout: 12000, maxBuffer: 1024 * 1024, windowsHide: true });
  return stdout.trimEnd();
}

function event(db, kind, payload, run = null) {
  db.prepare("INSERT INTO event(run,created,kind,payload) VALUES (?,?,?,?)")
    .run(run, Date.now(), kind, JSON.stringify(payload));
}

function catalog(db) {
  const project = (id) => {
    const row = db.prepare("SELECT p.*, t.team FROM project p LEFT JOIN project_team t ON t.project=p.id WHERE p.id=?").get(id);
    if (!row) throw problem(404, "Project not found");
    return row;
  };
  const versionOf = (id, version) => {
    const row = db.prepare(`SELECT d.id, d.project, d.team, d.scope, d.kind, d.name, v.version, v.payload
      FROM definition d JOIN definition_version v ON v.id=d.id
      WHERE d.id=? AND v.version=COALESCE(?,d.version)`).get(id, version ?? null);
    if (!row) throw problem(404, "Definition not found");
    return { ...row, payload: JSON.parse(row.payload) };
  };
  function definitionOwner(scope, projectId, teamName) {
    if (scope === "personal") return { scope, project: null, team: null };
    if (scope === "team") {
      const team = string(teamName, "team");
      if (!db.prepare("SELECT 1 FROM harness_team WHERE name=?").get(team)) throw problem(404, "Team not found");
      return { scope, project: null, team };
    }
    if (scope !== "project") throw problem(400, "Invalid definition scope");
    return { scope, project: project(string(projectId, "project")).id, team: null };
  }
  const sameOwner = (a, b) => a.scope === b.scope && a.project === b.project && a.team === b.team;
  function availableTo(row, projectId) {
    if (row.scope === "personal") return true;
    if (row.scope === "project") return row.project === projectId;
    return row.scope === "team" && row.team === project(projectId).team;
  }
  function availableToOwner(row, owner) {
    return owner.scope === "project" ? availableTo(row, owner.project) : row.scope === "personal" || sameOwner(row, owner);
  }
  function writeDefinition(body) {
    const owner = definitionOwner(body.scope ?? "project", body.project, body.team);
    if (owner.project && project(owner.project).archived) throw problem(409, "Project is archived");
    const parsed = definition(body.kind, body.payload);
    const old = body.id ? versionOf(string(body.id, "id")) : null;
    if (old && (!sameOwner(old, owner) || old.kind !== body.kind)) throw problem(400, "Definition owner and kind are immutable");
    if (old && integer(body.version, "version", 1, Number.MAX_SAFE_INTEGER) !== old.version) {
      throw problem(409, "Definition changed. Reload it before saving.");
    }
    const id = old?.id ?? randomUUID();
    const next = (old?.version ?? 0) + 1;
    const target = body.kind === "harness" ? parsed.model : parsed.harness;
    const refVersion = body.referenceVersion === undefined ? undefined
      : integer(body.referenceVersion, "reference version", 1, Number.MAX_SAFE_INTEGER);
    const ref = target ? versionOf(target, refVersion) : null;
    if (ref && (body.kind === "harness" ? ref.kind !== "model" || !sameOwner(ref, owner)
      : ref.kind !== "harness" || !availableToOwner(ref, owner))) {
      throw problem(400, "Definition reference has an incompatible scope or kind");
    }
    const duplicate = db.prepare("SELECT id FROM definition WHERE scope=? AND project IS ? AND team IS ? AND kind=? AND name=?")
      .get(owner.scope, owner.project, owner.team, body.kind, parsed.name);
    if (duplicate && duplicate.id !== id) throw problem(409, "Definition name is already in use");
    if (old) db.prepare("UPDATE definition SET version=?, name=? WHERE id=?").run(next, parsed.name, id);
    else db.prepare("INSERT INTO definition(id,scope,project,team,kind,name,version) VALUES (?,?,?,?,?,?,?)")
      .run(id, owner.scope, owner.project, owner.team, body.kind, parsed.name, next);
    db.prepare("INSERT INTO definition_version VALUES (?,?,?)").run(id, next, JSON.stringify(parsed));
    if (ref) db.prepare("INSERT INTO definition_ref VALUES (?,?,?,?)").run(id, next, ref.id, ref.version);
    event(db, "definition.saved", { id, version: next, kind: body.kind });
    return versionOf(id, next);
  }
  async function saveProject(body) {
    const name = string(body.name, "name");
    const root = string(body.root, "Git root", 4000);
    if (!path.isAbsolute(root)) throw problem(400, "Git root must be absolute");
    let resolved, branch;
    try {
      resolved = await fs.realpath(root);
      const top = await fs.realpath(await git(resolved, ["rev-parse", "--show-toplevel"]));
      if (top !== resolved) throw new Error("Not repository root");
      branch = body.branch ? string(body.branch, "base branch") : await git(resolved, ["branch", "--show-current"]);
      string(branch, "base branch");
      await git(resolved, ["show-ref", "--verify", "refs/heads/" + branch]);
    } catch {
      throw problem(400, "An existing Git root and local branch are required");
    }
    const id = body.id ? project(string(body.id, "id")).id : randomUUID();
    return transaction(db, () => {
      const duplicate = db.prepare("SELECT id FROM project WHERE root=?").get(resolved);
      if (duplicate && duplicate.id !== id) throw problem(409, "Git root already registered");
      if (body.id && project(id).root !== resolved &&
          (db.prepare("SELECT 1 FROM task WHERE project=? LIMIT 1").get(id) ||
           db.prepare("SELECT 1 FROM workflow_run r JOIN workflow w ON r.workflow=w.id WHERE w.project=? LIMIT 1").get(id))) {
        throw problem(409, "A project with run history cannot change its Git root");
      }
      const previousTeam = body.id ? project(id).team : null;
      const team = body.team === undefined ? previousTeam : body.team ? string(body.team, "team") : null;
      if (previousTeam && previousTeam !== team && db.prepare(`
        SELECT 1 FROM definition_ref r JOIN definition source ON source.id=r.source
          JOIN definition target ON target.id=r.target WHERE source.project=? AND target.team=?
        UNION ALL
        SELECT 1 FROM workflow_definition r JOIN workflow w ON w.id=r.workflow
          JOIN definition target ON target.id=r.target WHERE w.project=? AND target.team=? LIMIT 1
      `).get(id, previousTeam, id, previousTeam)) {
        throw problem(409, "이 프로젝트에 저장된 Workflow 또는 Loop가 기존 팀 하네스를 참조하고 있습니다.");
      }
      db.prepare(`INSERT INTO project VALUES (?,?,?,?,0)
        ON CONFLICT(id) DO UPDATE SET root=excluded.root,name=excluded.name,branch=excluded.branch`)
        .run(id, resolved, name, branch);
      if (team) {
        db.prepare("INSERT OR IGNORE INTO harness_team VALUES (?)").run(team);
        db.prepare("INSERT INTO project_team VALUES (?,?) ON CONFLICT(project) DO UPDATE SET team=excluded.team").run(id, team);
      } else if (previousTeam) db.prepare("DELETE FROM project_team WHERE project=?").run(id);
      event(db, "project.saved", { id });
      return project(id);
    });
  }
  return {
    project, saveProject, versionOf, writeDefinition, availableTo,
    saveDefinition: (body) => transaction(db, () => writeDefinition(body)),
    projects: () => db.prepare("SELECT p.*, t.team FROM project p LEFT JOIN project_team t ON t.project=p.id ORDER BY p.name").all(),
    teams: () => db.prepare("SELECT name FROM harness_team ORDER BY name").all().map(({ name }) => name),
    saveTeam(name) {
      const team = string(name, "team");
      db.prepare("INSERT OR IGNORE INTO harness_team VALUES (?)").run(team);
      return team;
    },
    definitions(id, scope, team) {
      if (scope) {
        const owner = definitionOwner(scope, id, team);
        return db.prepare("SELECT id FROM definition WHERE scope=? AND project IS ? AND team IS ? ORDER BY kind,name")
          .all(owner.scope, owner.project, owner.team).map(({ id }) => versionOf(id));
      }
      if (!id) return [];
      const owner = project(id);
      return db.prepare(`SELECT id FROM definition WHERE project=? OR team=? OR scope='personal'
        ORDER BY CASE scope WHEN 'project' THEN 1 WHEN 'team' THEN 2 ELSE 3 END, kind,name`)
        .all(id, owner.team).map(({ id }) => versionOf(id));
    },
    dependency: (row) => {
      const ref = db.prepare("SELECT target,target_version FROM definition_ref WHERE source=? AND version=?").get(row.id, row.version);
      return ref && versionOf(ref.target, ref.target_version);
    },
    archive(id) {
      return transaction(db, () => {
        project(id);
        db.prepare("UPDATE project SET archived=1 WHERE id=?").run(id);
        event(db, "project.archived", { id });
        return project(id);
      });
    },
    remove(id) {
      return transaction(db, () => {
        versionOf(id);
        if (db.prepare("SELECT 1 FROM definition_ref WHERE target=?").get(id) ||
            db.prepare("SELECT 1 FROM run WHERE definition=?").get(id) ||
            db.prepare("SELECT 1 FROM workflow_definition WHERE target=?").get(id)) throw problem(409, "Definition is referenced");
        db.prepare("DELETE FROM definition WHERE id=?").run(id);
        event(db, "definition.deleted", { id });
      });
    },
  };
}

module.exports = { catalog, git, event };
