/* omp-live-map · model · 한 맵(프로젝트 띠 > Task 줄 > Workflow 단계 > 세션)의 순서와 자동 배치. DOM·상태 접근 없음.
   좌표는 맵 세계 좌표(px, 100% 배율)다. 옮긴 카드는 manual[key] = { band, dx, dy }(띠 원점 기준)로 그 자리에 두고,
   나머지는 계속 자동 배치한다. 띠 순서를 바꿔도 옮긴 카드는 자기 띠를 따라간다. 접기·펼치기·배율별 정보 밀도는 없다(카드 문장·높이는 model/agent-lines.js). */

const UMAP = Object.freeze({
  PAD: 20, HEAD_H: 76, BAND_GAP: 34, ROW_GAP: 26, MIN_W: 1360,
  TASK_W: 272, TASK_H: 120, ADD_H: 50,
  STAGE_X: 330, STAGE_W: 380, STAGE_H: 120, STAGE_GAP: 56,
  CHIP_H: 30, SESS_TOP: 30,
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

// bands: [{ key, adding, tasks: [{ id, stages: [{ id, sessions: [item] }] }], free: [{ folder, sessions: [item] }] }]
//   item: { id, node(있으면 세션, 없으면 기록 없는 자리표), lines(카드 문장, model/agent-lines.js umapAgentLines), children: [item] } — children 은 그 에이전트가 띄운 서브에이전트(중첩 가능).
// 돌려주는 값: { bands: [{ key, x, y, w, h }], boxes: { key: { x, y, w, h, band, kind, depth, manual } }, links: [{ from, to, kind }], width, height }
// 접기·펼치기는 없다. 맵 크기는 시간 필터와 띠 순서로 다룬다. 배율과 무관하다(같은 입력 → 같은 배치).
function umapLayout(bands, { manual = {}, width = UMAP.MIN_W } = {}) {
  const U = UMAP, A = UMAP_AGENT, out = { bands: [], boxes: {}, links: [], width: 0, height: 0 };
  // 에이전트 나무 하나: 부모 아래로 서브에이전트를 한 칸씩 들여 쌓는다(겹치지 않는다). 돌려주는 값: { w, h }(나무 전체 크기)
  const tree = (put, item, x, y, from, depth = 0) => {
    const key = umapSessionKey(item.id), h = item.node ? umapAgentHeight(item.lines) : A.MISSING_H;
    put(key, "session", x + depth * A.INDENT, y, A.W, h, depth);
    out.links.push({ from, to: key, kind: depth ? "sub" : "session" });
    let bottom = y + h, w = depth * A.INDENT + A.W;
    for (const child of item.children || []) {
      const size = tree(put, child, x, bottom + A.GAP, key, depth + 1);
      bottom += A.GAP + size.h; w = Math.max(w, size.w);
    }
    return { w, h: bottom - y };
  };
  let y = 0;
  for (const band of bands) {
    const boxes = [];
    const put = (key, kind, x, yy, w, h, depth = 0) => { const box = { key, kind, x, y: yy, w, h, depth, band: band.key, manual: false }; boxes.push(box); return box; };
    let cy = U.HEAD_H, right = width;
    if (band.adding) { put("add:" + band.key, "add", U.PAD, cy, U.STAGE_X + 3 * (U.STAGE_W + U.STAGE_GAP) - U.PAD, U.ADD_H - 10); cy += U.ADD_H; }
    for (const task of band.tasks || []) {
      const taskKey = umapTaskKey(task.id);
      put(taskKey, "task", U.PAD, cy, U.TASK_W, U.TASK_H);
      let rowH = U.TASK_H, previous = taskKey, x = U.STAGE_X;
      for (const [index, stage] of (task.stages || []).entries()) {
        const key = umapStageKey(task.id, stage.id);
        const stageBox = put(key, "stage", x, cy, U.STAGE_W, U.STAGE_H);
        out.links.push({ from: previous, to: key, kind: index ? "flow" : "start" });
        previous = key;
        let sy = cy + U.STAGE_H + U.SESS_TOP, colW = U.STAGE_W;
        for (const item of stage.sessions || []) {
          const size = tree((...args) => put(...args), item, x, sy, key);
          sy += size.h + A.GAP; colW = Math.max(colW, size.w);
        }
        stageBox.w = colW; // 단계 칸은 그 아래 에이전트 나무 폭만큼 넓어진다(다음 단계와 겹치지 않는다).
        rowH = Math.max(rowH, sy - A.GAP - cy);
        x += colW + U.STAGE_GAP;
        right = Math.max(right, x - U.STAGE_GAP + U.PAD);
      }
      cy += rowH + U.ROW_GAP;
    }
    if (!(band.tasks || []).length && !(band.free || []).length && !band.adding) { put("empty:" + band.key, "empty", U.PAD, cy, 520, U.EMPTY_H - 10); cy += U.EMPTY_H; }
    // Task 없이 연 세션: 폴더별 한 줄 제목 + 세션마다 에이전트 나무 하나를 띠 폭 안에서 줄바꿈.
    for (const group of band.free || []) {
      put("folder:" + band.key + ":" + group.folder, "folder", U.PAD, cy, Math.min(right - U.PAD * 2, 900), U.LABEL_H - 6);
      cy += U.LABEL_H;
      let x = U.PAD, rowH = 0;
      for (const item of group.sessions) {
        const probe = [];
        const size = tree((...args) => probe.push(args), item, 0, 0, "folder:" + band.key + ":" + group.folder);
        if (x > U.PAD && x + size.w > right - U.PAD) { cy += rowH + U.FREE_GAP; x = U.PAD; rowH = 0; }
        for (const [key, kind, bx, by, w, h, depth] of probe) put(key, kind, x + bx, cy + by, w, h, depth);
        x += size.w + U.FREE_GAP; rowH = Math.max(rowH, size.h);
      }
      cy += rowH + U.ROW_GAP;
    }
    // 옮긴 카드: 같은 띠면 저장한 자리에 둔다.
    for (const box of boxes) {
      const spot = manual[box.key];
      if (spot && spot.band === band.key && Number.isFinite(spot.dx) && Number.isFinite(spot.dy)) {
        box.x = spot.dx; box.y = spot.dy; box.manual = true;
      }
      right = Math.max(right, box.x + box.w + U.PAD);
      cy = Math.max(cy, box.y + box.h + U.PAD);
    }
    const h = cy + U.PAD / 2;
    out.bands.push({ key: band.key, x: 0, y, w: right, h });
    for (const box of boxes) out.boxes[box.key] = { ...box, y: box.y + y };
    out.width = Math.max(out.width, right);
    y += h + U.BAND_GAP;
  }
  out.height = Math.max(0, y - U.BAND_GAP);
  for (const band of out.bands) band.w = out.width;
  // 자유 세션의 첫 선(폴더 제목 → 세션)은 그리지 않는다.
  out.links = out.links.filter(({ from, to }) => out.boxes[from] && out.boxes[to] && !from.startsWith("folder:"));
  return out;
}

// 두 상자가 겹치는지(테스트·배치 점검용).
const umapOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Workflow 편집: 단계 id 목록 위의 순수 연산(화면은 결과 목록을 서버 tasks/workflow 로 보낸다).
function umapInsertStage(ids, index, id) { const next = [...ids]; next.splice(Math.max(0, Math.min(index, next.length)), 0, id); return next; }
function umapMoveStage(ids, id, index) {
  const next = ids.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
const umapRemoveStage = (ids, id) => ids.filter((item) => item !== id);
// 끌어 놓은 x 좌표 → 끼울 자리. xs(단계 칸의 왼쪽 x 들)를 주면 가장 가까운 칸, 없으면 기본 칸 폭으로 센다.
function umapDropIndex(x, count, xs) {
  if (Array.isArray(xs) && xs.length) return Math.max(0, Math.min(count - 1, xs.reduce((best, sx, i) => (Math.abs(x - sx) < Math.abs(x - xs[best]) ? i : best), 0)));
  return Math.max(0, Math.min(count - 1, Math.round((x - UMAP.STAGE_X) / (UMAP.STAGE_W + UMAP.STAGE_GAP))));
}

// 전체 보기: 내용(content {width,height})을 화면(view {width,height})에 맞추는 배율·위치. 작은 내용은 max 까지 키우고 가운데에 둔다.
// 처음 열 때(umapInitialView)는 폭만 맞추고(아래로는 굴려 본다) 읽을 수 있는 70%~100% 안에서 고른다.
function umapFitView(content, view, { min = 0.2, max = 1.25, pad = 24, height = true } = {}) {
  if (!(content.width > 0 && content.height > 0)) return { x: pad, y: pad, k: 1 }; // 그릴 것이 없으면 100%
  const cw = content.width, ch = content.height;
  const fit = Math.min((view.width - pad * 2) / cw, height ? (view.height - pad * 2) / ch : Infinity);
  const k = Math.round(Math.min(max, Math.max(min, fit)) * 1000) / 1000;
  const x = cw * k <= view.width - pad * 2 ? (view.width - cw * k) / 2 : pad;
  return { x: Math.round(x), y: pad, k };
}
const umapInitialView = (content, view) => umapFitView(content, view, { min: 0.7, max: 1, height: false });
