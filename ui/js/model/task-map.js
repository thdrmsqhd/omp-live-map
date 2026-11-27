/* omp-live-map · model · 한 맵(프로젝트 띠 > Task 줄 > Workflow 단계 > 세션)의 순서와 자동 배치. DOM·상태 접근 없음.
   좌표는 맵 세계 좌표(px, 100% 배율)다. 옮긴 카드는 manual[key] = { band, dx, dy }(띠 원점 기준)로 그 자리에 두고,
   나머지는 계속 자동 배치한다. 띠를 접거나 순서를 바꿔도 옮긴 카드는 자기 띠를 따라간다. */

const UMAP = Object.freeze({
  PAD: 20, HEAD_H: 76, BAND_GAP: 34, ROW_GAP: 26, MIN_W: 1360,
  TASK_W: 272, TASK_H: 120, DONE_W: 620, DONE_H: 46, ADD_H: 50,
  STAGE_X: 330, STAGE_W: 212, STAGE_H: 120, STAGE_GAP: 56,
  SESS_W: 212, SESS_H: 92, CHIP_H: 30, SESS_TOP: 30, SESS_GAP: 10,
  LABEL_H: 26, FREE_GAP: 14, EMPTY_H: 44,
});

// Task 상태: 이름·색·줄 순서 묶음(0 개입 필요 → 1 진행 중 → 2 대기 → 3 완료). 사용자 칸은 대기로 묶는다.
const TASK_STATUS = Object.freeze({
  backlog: { label: "Backlog", color: "#6f8296", group: 2 },
  ready: { label: "준비", color: "#4aa8ff", group: 2 },
  running: { label: "진행 중", color: "#2fbf9b", group: 1 },
  waiting_approval: { label: "승인 대기", color: "#e0a83c", group: 0 },
  blocked: { label: "보류", color: "#e3564f", group: 0 },
  completed: { label: "완료", color: "#8f7fe0", group: 3 },
});
const UMAP_GROUPS = ["개입 필요", "진행 중", "대기", "완료"];
const umapTaskGroup = (task) => (TASK_STATUS[task?.status] ?? TASK_STATUS.backlog).group;
const umapTaskBusy = (task) => task?.status === "running" || task?.status === "waiting_approval";

// 줄 순서: 묶음 순서, 같은 묶음 안에서는 최근에 바뀐 Task 가 위.
function umapOrderTasks(tasks) {
  return [...(tasks || [])].sort((a, b) => umapTaskGroup(a) - umapTaskGroup(b)
    || (b.updated || 0) - (a.updated || 0) || String(a.id).localeCompare(String(b.id)));
}

// 띠 순서: 저장한 순서(order)를 먼저, 나머지는 들어온 순서.
function umapOrderBands(bands, order) {
  const rank = new Map((order || []).map((key, index) => [key, index]));
  return [...bands].map((band, index) => ({ band, index }))
    .sort((a, b) => (rank.has(a.band.key) ? rank.get(a.band.key) : 1e6 + a.index) - (rank.has(b.band.key) ? rank.get(b.band.key) : 1e6 + b.index))
    .map(({ band }) => band);
}

const umapStageKey = (taskId, nodeId) => "stage:" + taskId + ":" + nodeId;
const umapTaskKey = (taskId) => "task:" + taskId;
const umapSessionKey = (nodeId) => "sess:" + nodeId;

// bands: [{ key, collapsed, adding, tasks: [{ id, collapsed, stages: [{ id, sessions: [{ id, compact }] }] }], free: [{ folder, sessions }] }]
// 돌려주는 값: { bands: [{ key, x, y, w, h }], boxes: { key: { x, y, w, h, band, kind, manual } }, links: [{ from, to, kind }], width, height }
function umapLayout(bands, { manual = {}, width = UMAP.MIN_W } = {}) {
  const U = UMAP, out = { bands: [], boxes: {}, links: [], width: 0, height: 0 };
  let y = 0;
  for (const band of bands) {
    const boxes = [];
    const put = (key, kind, x, yy, w, h) => { const box = { key, kind, x, y: yy, w, h, band: band.key, manual: false }; boxes.push(box); return box; };
    let cy = U.HEAD_H, right = width;
    if (!band.collapsed) {
      if (band.adding) { put("add:" + band.key, "add", U.PAD, cy, U.STAGE_X + 3 * (U.STAGE_W + U.STAGE_GAP) - U.PAD, U.ADD_H - 10); cy += U.ADD_H; }
      for (const task of band.tasks || []) {
        const taskKey = umapTaskKey(task.id);
        if (task.collapsed) {
          put(taskKey, "task", U.PAD, cy, U.DONE_W, U.DONE_H);
          cy += U.DONE_H + U.ROW_GAP / 2;
          continue;
        }
        put(taskKey, "task", U.PAD, cy, U.TASK_W, U.TASK_H);
        let rowH = U.TASK_H, previous = taskKey;
        (task.stages || []).forEach((stage, index) => {
          const key = umapStageKey(task.id, stage.id);
          const x = U.STAGE_X + index * (U.STAGE_W + U.STAGE_GAP);
          put(key, "stage", x, cy, U.STAGE_W, U.STAGE_H);
          out.links.push({ from: previous, to: key, kind: index ? "flow" : "start" });
          previous = key;
          let sy = cy + U.STAGE_H + U.SESS_TOP;
          for (const session of stage.sessions || []) {
            const h = session.compact ? U.CHIP_H : U.SESS_H;
            put(umapSessionKey(session.id), "session", x, sy, U.SESS_W, h);
            out.links.push({ from: key, to: umapSessionKey(session.id), kind: "session" });
            sy += h + U.SESS_GAP;
          }
          rowH = Math.max(rowH, sy - U.SESS_GAP - cy);
          right = Math.max(right, x + U.STAGE_W + U.PAD);
        });
        cy += rowH + U.ROW_GAP;
      }
      if (!(band.tasks || []).length && !(band.free || []).length && !band.adding) { put("empty:" + band.key, "empty", U.PAD, cy, 520, U.EMPTY_H - 10); cy += U.EMPTY_H; }
      // Task 없이 연 세션: 폴더별 한 줄 제목 + 카드를 띠 폭 안에서 줄바꿈.
      const cols = Math.max(1, Math.floor((right - U.PAD * 2 + U.FREE_GAP) / (U.SESS_W + U.FREE_GAP)));
      for (const group of band.free || []) {
        put("folder:" + band.key + ":" + group.folder, "folder", U.PAD, cy, Math.min(right - U.PAD * 2, 900), U.LABEL_H - 6);
        cy += U.LABEL_H;
        let rowH = 0;
        group.sessions.forEach((session, index) => {
          if (index && index % cols === 0) { cy += rowH + U.FREE_GAP; rowH = 0; }
          const h = session.compact ? U.CHIP_H : U.SESS_H;
          put(umapSessionKey(session.id), "session", U.PAD + (index % cols) * (U.SESS_W + U.FREE_GAP), cy, U.SESS_W, h);
          rowH = Math.max(rowH, h);
        });
        cy += rowH + U.ROW_GAP;
      }
    }
    // 옮긴 카드: 같은 띠, 띠가 펼쳐져 있을 때만 저장한 자리에 둔다.
    for (const box of boxes) {
      const spot = manual[box.key];
      if (spot && spot.band === band.key && Number.isFinite(spot.dx) && Number.isFinite(spot.dy)) {
        box.x = spot.dx; box.y = spot.dy; box.manual = true;
      }
      right = Math.max(right, box.x + box.w + U.PAD);
      cy = Math.max(cy, box.y + box.h + U.PAD);
    }
    const h = band.collapsed ? U.HEAD_H - 18 : cy + U.PAD / 2;
    out.bands.push({ key: band.key, x: 0, y, w: right, h });
    for (const box of boxes) out.boxes[box.key] = { ...box, x: box.x, y: box.y + y };
    out.width = Math.max(out.width, right);
    y += h + U.BAND_GAP;
  }
  out.height = Math.max(0, y - U.BAND_GAP);
  for (const band of out.bands) band.w = out.width;
  out.links = out.links.filter(({ from, to }) => out.boxes[from] && out.boxes[to]);
  return out;
}

// Workflow 편집: 단계 id 목록 위의 순수 연산(화면은 결과 목록을 서버 tasks/workflow 로 보낸다).
function umapInsertStage(ids, index, id) { const next = [...ids]; next.splice(Math.max(0, Math.min(index, next.length)), 0, id); return next; }
function umapMoveStage(ids, id, index) {
  const next = ids.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
const umapRemoveStage = (ids, id) => ids.filter((item) => item !== id);
// 끌어 놓은 x 좌표 → 끼울 자리(단계 칸 가운데 기준).
const umapDropIndex = (x, count) => Math.max(0, Math.min(count - 1, Math.round((x - UMAP.STAGE_X) / (UMAP.STAGE_W + UMAP.STAGE_GAP))));
