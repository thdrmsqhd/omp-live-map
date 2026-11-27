"use strict";

// 개발 Task(칸반 카드). 카드는 한 줄로 만들고(제목 = 입력한 글), 본문·시간 한도·예산은 카드에서 바로 고친다.
// 실행(▶)은 카드의 Workflow 를 카드 본문으로 돌린다. 본문에 '완료 조건:'으로 시작하는 줄이 있으면 그 줄부터 끝까지를
// 완료 조건으로 쓰고, 없으면 기본 문장을 쓴다. 시간 한도·예산을 비워 두면(NULL) 기본값을 쓴다.
const { randomUUID } = require("node:crypto");
const { transaction } = require("../infrastructure/sqlite");
const { event } = require("./catalog");
const { string, integer } = require("./definitions");
const { problem } = require("./state");

const DEFAULTS = Object.freeze({ timeoutMs: 20 * 60000, budgetCents: 6000,
  acceptance: "작업 목표를 끝내고, 기존 기능과 테스트가 깨지지 않는다." });
// 실행이 정하는 칸. 사람이 카드를 이 칸으로 옮기지는 않는다.
const RUN_STATES = new Set(["running", "waiting_approval", "completed"]);

const progress = {
  queued: "running", running: "running", waiting_approval: "waiting_approval", paused: "blocked",
  interrupted: "blocked", failed: "blocked", cancelled: "blocked", limit_exceeded: "blocked", succeeded: "completed",
};

// 카드 본문 → 실행 지시. '완료 조건:' 줄(과 그 뒤)을 떼어 완료 조건으로 쓴다.
function runInstruction(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const at = lines.findIndex((line) => /^\s*완료\s*조건\s*:/.test(line));
  const goal = (at === -1 ? lines : lines.slice(0, at)).join("\n").trim();
  const done = at === -1 ? "" : [lines[at].replace(/^\s*완료\s*조건\s*:\s*/, ""), ...lines.slice(at + 1)].join("\n").trim();
  return "작업 목표\n" + goal + "\n\n완료 조건\n" + (done || DEFAULTS.acceptance);
}

function sdlcTasks(db, catalog, workflows, stages = null) {
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
      WHERE t.project=? ORDER BY t.updated DESC,t.id`).all(project)
      .map((row) => ({ ...row, timeoutMs: row.timeout_ms ?? DEFAULTS.timeoutMs, budgetCents: row.budget_cents ?? DEFAULTS.budgetCents }));
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
  const limit = (value, label, min, max) => value === null ? null : integer(value, label, min, max);
  // 새 카드: { project, text | title+instruction, workflow, version }. 기존 카드: { id, revision, 바꿀 칸만 }.
  function save(input) {
    const owner = string(input.project, "project");
    return transaction(db, () => {
      if (catalog.project(owner).archived) throw problem(409, "Project is archived");
      const existing = input.id ? get(string(input.id, "task id")) : null;
      if (!existing) {
        const text = string(input.text ?? input.instruction, "task text", 12000);
        const title = input.title ? string(input.title, "task title") : text.split(/\r?\n/)[0].trim().slice(0, 240);
        const workflow = workflows.get(owner, string(input.workflow, "workflow"),
          integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER));
        const id = randomUUID();
        db.prepare(`INSERT INTO sdlc_task(id,project,title,instruction,status,workflow,workflow_version,revision,updated,timeout_ms,budget_cents)
          VALUES (?,?,?,?,'backlog',?,?,1,?,?,?)`).run(id, owner, title, string(input.instruction ?? text, "task instruction", 12000),
          workflow.id, workflow.version, Date.now(), limit(input.timeoutMs ?? null, "task time limit", 60000, 3600000),
          limit(input.budgetCents ?? null, "task budget", 0, 100000));
        event(db, "sdlc.task.saved", { id, project: owner });
        return get(id);
      }
      if (existing.project !== owner) throw problem(409, "Task ownership is immutable");
      expectRevision(existing, input.revision);
      editable(existing);
      const next = { title: existing.title, instruction: existing.instruction, workflow: existing.workflow,
        workflow_version: existing.workflow_version, timeout_ms: existing.timeout_ms, budget_cents: existing.budget_cents };
      if (input.title !== undefined) next.title = string(input.title, "task title");
      // 본문은 비워 둘 수 있다(제목만으로도 실행 지시가 된다).
      if (input.instruction !== undefined) next.instruction = input.instruction === "" ? "" : string(input.instruction, "task instruction", 12000);
      if (input.workflow !== undefined) {
        const workflow = workflows.get(owner, string(input.workflow, "workflow"), integer(input.version, "workflow version", 1, Number.MAX_SAFE_INTEGER));
        next.workflow = workflow.id;
        next.workflow_version = workflow.version;
      }
      if (input.timeoutMs !== undefined) next.timeout_ms = limit(input.timeoutMs, "task time limit", 60000, 3600000);
      if (input.budgetCents !== undefined) next.budget_cents = limit(input.budgetCents, "task budget", 0, 100000);
      db.prepare(`UPDATE sdlc_task SET title=?,instruction=?,workflow=?,workflow_version=?,timeout_ms=?,budget_cents=?,
        revision=revision+1,updated=? WHERE id=?`).run(next.title, next.instruction, next.workflow, next.workflow_version,
        next.timeout_ms, next.budget_cents, Date.now(), existing.id);
      event(db, "sdlc.task.saved", { id: existing.id, project: owner });
      return get(existing.id);
    });
  }
  // 사람이 옮길 수 있는 칸: Backlog·준비·보류와 사용자가 더한 칸. 진행 중·승인 대기·완료는 실행이 정한다.
  function movable(project, status) {
    const known = stages ? stages.list(project).some((stage) => stage.status === status) : ["backlog", "ready"].includes(status);
    if (!known || RUN_STATES.has(status)) throw problem(400, "Task can be moved manually to Backlog, Ready or a custom column");
  }
  function move(id, status, revision) {
    return transaction(db, () => {
      const task = get(string(id, "task id"));
      if (catalog.project(task.project).archived) throw problem(409, "Project is archived");
      movable(task.project, string(status, "task status", 64));
      expectRevision(task, revision);
      editable(task);
      db.prepare("UPDATE sdlc_task SET status=?,revision=revision+1,updated=? WHERE id=?").run(status, Date.now(), task.id);
      event(db, "sdlc.task.status", { id: task.id, status });
      return get(task.id);
    });
  }
  // ▶: 어느 칸에 있든 '준비'로 올린 뒤 실행 입력(한도·예산)을 돌려준다. 실행 중이면 409.
  function prepareRun(id) {
    return transaction(db, () => {
      const task = get(string(id, "task id"));
      if (catalog.project(task.project).archived) throw problem(409, "Project is archived");
      editable(task);
      if (task.status !== "ready") {
        db.prepare("UPDATE sdlc_task SET status='ready',revision=revision+1,updated=? WHERE id=?").run(Date.now(), task.id);
        event(db, "sdlc.task.status", { id: task.id, status: "ready" });
      }
      return { task: task.id, timeoutMs: task.timeout_ms ?? DEFAULTS.timeoutMs, budgetCents: task.budget_cents ?? DEFAULTS.budgetCents };
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
  return { get, list, save, move, prepareRun, followRun, instructionFor: (task) => runInstruction(task.instruction || task.title) };
}

module.exports = { sdlcTasks, runInstruction, TASK_DEFAULTS: DEFAULTS };
