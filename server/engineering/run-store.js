"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { event } = require("./catalog");
const { transaction } = require("./database");
const { string } = require("./definitions");
const { checkTransition, problem } = require("./state");

function runStore(db, catalog) {
  function get(id) {
    const result = db.prepare(`SELECT r.*,t.title,t.instruction,t.project FROM run r
      JOIN task t ON t.id=r.task WHERE r.id=?`).get(id);
    if (!result) throw problem(404, "Run not found");
    return result;
  }
  function change(id, target) {
    const previous = get(id);
    checkTransition(previous.status, target);
    db.prepare("UPDATE run SET status=? WHERE id=?").run(target, id);
    event(db, "run.status", { status: target }, id);
    return get(id);
  }
  function create(body, key) {
    const request = {
      project: string(body.project, "project"),
      definition: string(body.definition, "loop"),
      title: string(body.title, "task title"),
      instruction: string(body.instruction, "task instruction", 12000),
    };
    const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    return transaction(db, () => {
      const existing = db.prepare("SELECT id,request_hash FROM run WHERE idempotency_key=?").get(key);
      if (existing) {
        if (existing.request_hash !== hash) throw problem(409, "Idempotency key was used for a different request");
        return { run: get(existing.id), created: false };
      }
      const owner = catalog.project(request.project);
      const loop = catalog.versionOf(request.definition);
      if (owner.archived || loop.project !== owner.id || loop.kind !== "loop") throw problem(400, "Active project and its loop are required");
      const task = randomUUID(), id = randomUUID(), now = Date.now();
      db.prepare("INSERT INTO task VALUES (?,?,?,?)").run(task, owner.id, request.title, request.instruction);
      db.prepare(`INSERT INTO run VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, task, loop.id, loop.version, "queued", null,
        now, now + loop.payload.timeoutMs, key, hash);
      db.prepare("INSERT INTO node_run VALUES (?,?,?)").run(randomUUID(), id, "loop");
      event(db, "run.created", { task, definition: loop.id, version: loop.version }, id);
      return { run: get(id), created: true };
    });
  }
  function startAttempt(id) {
    return transaction(db, () => {
      if (get(id).status !== "running") throw problem(409, "Run is not running");
      const previous = db.prepare("SELECT COALESCE(MAX(number),0) AS n FROM attempt WHERE run=?").get(id);
      const number = previous.n + 1;
      db.prepare("INSERT INTO attempt VALUES (?,?,?, ?,NULL,NULL)").run(id, number, "running", Date.now());
      event(db, "attempt.started", { number }, id);
      return number;
    });
  }
  function finishAttempt(id, number, status, outcome) {
    transaction(db, () => {
      const result = db.prepare(`UPDATE attempt SET status=?,outcome=?,ended=?
        WHERE run=? AND number=? AND status='running'`).run(status, JSON.stringify(outcome), Date.now(), id, number);
      if (!result.changes) throw problem(409, "Attempt is no longer active");
      event(db, "attempt.finished", { number, status }, id);
    });
  }
  function recover() {
    transaction(db, () => {
      const pending = db.prepare("SELECT id FROM run WHERE status='running'").all();
      for (const { id } of pending) {
        db.prepare("UPDATE attempt SET status='uncertain',ended=? WHERE run=? AND status='running'").run(Date.now(), id);
        change(id, "interrupted");
      }
      for (const { id } of db.prepare("SELECT id FROM run WHERE status='queued'").all()) change(id, "blocked");
    });
  }
  return {
    create, get, startAttempt, finishAttempt, recover,
    block: (id, detail) => transaction(db, () => {
      change(id, "blocked");
      event(db, "run.blocked", { detail }, id);
    }),
    blockedReason: (id) => {
      const entry = db.prepare("SELECT payload FROM event WHERE run=? AND kind='run.blocked' ORDER BY seq DESC LIMIT 1").get(id);
      return entry ? JSON.parse(entry.payload).detail : null;
    },
    change: (id, target) => transaction(db, () => change(id, target)),
    workspace: (id, workspace) => db.prepare("UPDATE run SET workspace=? WHERE id=?").run(workspace, id),
    attempts: (id) => db.prepare("SELECT * FROM attempt WHERE run=? ORDER BY number").all(id)
      .map((row) => ({ ...row, outcome: row.outcome ? JSON.parse(row.outcome) : null })),
    list: (project) => db.prepare(`SELECT r.id,r.status,r.created,t.title FROM run r JOIN task t ON r.task=t.id
      WHERE t.project=? ORDER BY r.created DESC,r.id LIMIT 100`).all(project),
    events: (after) => db.prepare("SELECT * FROM event WHERE seq>? ORDER BY seq LIMIT 100").all(after)
      .map((row) => ({ ...row, payload: JSON.parse(row.payload) })),
  };
}

module.exports = { runStore };
