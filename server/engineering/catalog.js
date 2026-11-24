"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { transaction } = require("./database");
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
    const row = db.prepare("SELECT * FROM project WHERE id=?").get(id);
    if (!row) throw problem(404, "Project not found");
    return row;
  };
  const versionOf = (id, version) => {
    const row = db.prepare(`SELECT d.id, d.project, d.kind, d.name, v.version, v.payload
      FROM definition d JOIN definition_version v ON v.id=d.id
      WHERE d.id=? AND v.version=COALESCE(?,d.version)`).get(id, version ?? null);
    if (!row) throw problem(404, "Definition not found");
    return { ...row, payload: JSON.parse(row.payload) };
  };
  function saveDefinition(body) {
    const owner = project(string(body.project, "project"));
    if (owner.archived) throw problem(409, "Project is archived");
    const parsed = definition(body.kind, body.payload);
    return transaction(db, () => {
      const old = body.id ? versionOf(string(body.id, "id")) : null;
      if (old && (old.project !== owner.id || old.kind !== body.kind)) throw problem(400, "Definition owner and kind are immutable");
      if (old && integer(body.version, "version", 1, Number.MAX_SAFE_INTEGER) !== old.version) {
        throw problem(409, "Definition changed. Reload it before saving.");
      }
      const id = old?.id ?? randomUUID();
      const next = (old?.version ?? 0) + 1;
      const target = body.kind === "harness" ? parsed.model : parsed.harness;
      const ref = target ? versionOf(target) : null;
      if (ref && (ref.project !== owner.id || ref.kind !== (body.kind === "harness" ? "model" : "harness"))) {
        throw problem(400, "Definition reference belongs to another project or has the wrong type");
      }
      const duplicate = db.prepare("SELECT id FROM definition WHERE project=? AND kind=? AND name=?").get(owner.id, body.kind, parsed.name);
      if (duplicate && duplicate.id !== id) throw problem(409, "Definition name is already in use");
      if (old) db.prepare("UPDATE definition SET version=?, name=? WHERE id=?").run(next, parsed.name, id);
      else db.prepare("INSERT INTO definition VALUES (?,?,?,?,?)").run(id, owner.id, body.kind, parsed.name, next);
      db.prepare("INSERT INTO definition_version VALUES (?,?,?)").run(id, next, JSON.stringify(parsed));
      if (ref) db.prepare("INSERT INTO definition_ref VALUES (?,?,?,?)").run(id, next, ref.id, ref.version);
      event(db, "definition.saved", { id, version: next, kind: body.kind });
      return versionOf(id, next);
    });
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
          db.prepare("SELECT 1 FROM task WHERE project=? LIMIT 1").get(id)) {
        throw problem(409, "A project with run history cannot change its Git root");
      }
      db.prepare(`INSERT INTO project VALUES (?,?,?,?,0)
        ON CONFLICT(id) DO UPDATE SET root=excluded.root,name=excluded.name,branch=excluded.branch`)
        .run(id, resolved, name, branch);
      event(db, "project.saved", { id });
      return project(id);
    });
  }
  return {
    project, saveProject, versionOf, saveDefinition,
    projects: () => db.prepare("SELECT * FROM project ORDER BY name").all(),
    definitions: (id) => db.prepare("SELECT id FROM definition WHERE project=? ORDER BY kind,name").all(id).map((row) => versionOf(row.id)),
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
            db.prepare("SELECT 1 FROM run WHERE definition=?").get(id)) throw problem(409, "Definition is referenced");
        db.prepare("DELETE FROM definition WHERE id=?").run(id);
        event(db, "definition.deleted", { id });
      });
    },
  };
}

module.exports = { catalog, git, event };
