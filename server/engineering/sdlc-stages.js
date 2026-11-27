"use strict";

// 칸반 칸. 기본 칸 6개(실행이 카드를 옮기는 칸 포함)는 이름·순서만 바꾸고, 사용자가 더한 칸은 지울 수도 있다.
// 칸을 지우면 그 칸의 카드는 Backlog 로 돌아간다. 칸마다 기본 Workflow 를 묶던 설정은 없앴다(카드를 만들 때 고른다).
const { randomUUID } = require("node:crypto");
const { transaction } = require("../infrastructure/sqlite");
const { event } = require("./catalog");
const { string } = require("./definitions");
const { problem } = require("./state");

const defaults = [
  ["backlog", "Backlog"], ["ready", "준비"], ["running", "진행 중"], ["waiting_approval", "승인 대기"],
  ["blocked", "보류"], ["completed", "완료"],
];
const BUILTIN = new Set(defaults.map(([status]) => status));
const MAX_COLUMNS = 20;

function sdlcStages(db, catalog) {
  function list(project) {
    catalog.project(project);
    const configured = new Map(db.prepare("SELECT status,label,position FROM sdlc_stage WHERE project=?").all(project)
      .map((row) => [row.status, row]));
    const rows = defaults.map(([status, label], position) => ({ project, status, label, position, builtin: true, ...configured.get(status) }));
    for (const row of configured.values()) if (!BUILTIN.has(row.status)) rows.push({ project, ...row, builtin: false });
    const rank = (status) => { const index = defaults.findIndex(([key]) => key === status); return index === -1 ? 99 : index; };
    return rows.sort((a, b) => a.position - b.position || rank(a.status) - rank(b.status) || a.label.localeCompare(b.label));
  }
  function writable(project) {
    if (catalog.project(string(project, "project")).archived) throw problem(409, "Project is archived");
  }
  const upsert = (project, status, label, position) => db.prepare(`INSERT INTO sdlc_stage VALUES (?,?,?,?)
    ON CONFLICT(project,status) DO UPDATE SET label=excluded.label,position=excluded.position`).run(project, status, label, position);
  function find(project, status) {
    const stage = list(project).find((entry) => entry.status === status);
    if (!stage) throw problem(404, "Unknown stage");
    return stage;
  }
  // 칸 이름 바꾸기(칸 제목 더블클릭).
  function rename(input) {
    return transaction(db, () => {
      writable(input.project);
      const stage = find(input.project, string(input.status, "stage", 64));
      upsert(input.project, stage.status, string(input.label, "stage label", 64), stage.position);
      event(db, "sdlc.stage.saved", { project: input.project, status: stage.status });
      return list(input.project);
    });
  }
  // 칸 더하기(＋ 칸). 맨 오른쪽에 붙는다.
  function add(input) {
    return transaction(db, () => {
      writable(input.project);
      const current = list(input.project);
      if (current.length >= MAX_COLUMNS) throw problem(409, "칸은 " + MAX_COLUMNS + "개까지 만들 수 있습니다.");
      const status = "col-" + randomUUID().slice(0, 8);
      upsert(input.project, status, string(input.label ?? "새 칸", "stage label", 64), Math.min(50, current.length));
      event(db, "sdlc.stage.saved", { project: input.project, status });
      return list(input.project);
    });
  }
  // 칸 순서(끌어 놓기). 지금 칸 전부를 새 순서로 받는다.
  function order(input) {
    return transaction(db, () => {
      writable(input.project);
      const current = list(input.project);
      const wanted = Array.isArray(input.order) ? input.order : [];
      if (wanted.length !== current.length || new Set(wanted).size !== wanted.length ||
          !wanted.every((status) => current.some((stage) => stage.status === status))) throw problem(400, "Supply every column once");
      wanted.forEach((status, position) => upsert(input.project, status, current.find((stage) => stage.status === status).label, position));
      event(db, "sdlc.stage.saved", { project: input.project, order: wanted });
      return list(input.project);
    });
  }
  // 칸 지우기(칸 ⋯). 기본 칸은 실행 상태와 이어져 있어 지울 수 없다.
  function remove(input) {
    return transaction(db, () => {
      writable(input.project);
      const stage = find(input.project, string(input.status, "stage", 64));
      if (stage.builtin) throw problem(409, "기본 칸은 지울 수 없습니다. 이름만 바꿀 수 있습니다.");
      db.prepare("UPDATE sdlc_task SET status='backlog',revision=revision+1,updated=? WHERE project=? AND status=?")
        .run(Date.now(), input.project, stage.status);
      db.prepare("DELETE FROM sdlc_stage WHERE project=? AND status=?").run(input.project, stage.status);
      event(db, "sdlc.stage.removed", { project: input.project, status: stage.status });
      return list(input.project);
    });
  }
  return { list, rename, add, order, remove };
}

module.exports = { sdlcStages };
