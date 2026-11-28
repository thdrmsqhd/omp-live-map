/* omp-live-map · model · 프로젝트 타일 안(Task 줄 > Workflow 단계 > 세션)의 순서와 자동 배치. DOM·상태 접근 없음.
   좌표는 타일 캔버스 좌표(px, 100% 배율, 원점 = 타일 머리 아래)다. 옮긴 카드는 manual[key] = { band, dx, dy }(그 타일 캔버스 기준)로 그 자리에 두고,
   나머지는 계속 자동 배치한다. 타일을 옮기거나 크기를 바꿔도 옮긴 카드는 자기 타일을 따라간다(캔버스 폭 안으로 맞춘다).
   타일 폭(width)에 맞춰 배치한다: 넓으면(WIDE_W 이상) Task 카드 오른쪽에 단계를 늘어놓고 폭이 차면 다음 줄로 넘기고,
   좁으면 Task 카드 아래에 단계를 하나씩 쌓는다(단계 아래에 그 에이전트 나무). 좁아도 글자는 줄이지 않는다(카드 폭만 줄고 문장은 말줄임).
   접기·펼치기·배율별 정보 밀도는 없다(카드 문장·높이는 model/agent-lines.js). 타일 격자는 model/umap-wall.js. */

const UMAP = Object.freeze({
  PAD: 20, PAD_NARROW: 10, ROW_GAP: 26, STACK_GAP: 18, MIN_W: 1360, WIDE_W: 730,
  TASK_W: 272, TASK_H: 120, ADD_H: 50,
  STAGE_X: 330, STAGE_W: 380, STAGE_H: 120, STAGE_GAP: 56,
  SESS_TOP: 30, LABEL_H: 26, FREE_GAP: 14, EMPTY_H: 44,
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

const umapStageKey = (taskId, nodeId) => "stage:" + taskId + ":" + nodeId;
const umapTaskKey = (taskId) => "task:" + taskId;
const umapSessionKey = (nodeId) => "sess:" + nodeId;

// 에이전트 나무 하나를 (0,0) 기준으로 잰다: 부모 아래로 서브에이전트를 한 칸씩 들여 쌓는다(겹치지 않는다).
// maxW 가 있으면 카드 폭을 그 안으로 줄인다(최소 UMAP_AGENT.MIN_W, 글자 크기는 그대로). 돌려주는 값: { boxes, links, w, h }
function umapTree(item, maxW = Infinity, from = "") {
  const A = UMAP_AGENT, boxes = [], links = [];
  const walk = (node, y, parent, depth) => {
    const key = umapSessionKey(node.id), h = node.node ? umapAgentHeight(node.lines) : A.MISSING_H;
    const x = depth * A.INDENT, w = Math.max(A.MIN_W, Math.min(A.W, maxW - x));
    boxes.push({ key, kind: "session", x, y, w, h, depth });
    links.push({ from: parent, to: key, kind: depth ? "sub" : "session" });
    let bottom = y + h, right = x + w;
    for (const child of node.children || []) {
      const size = walk(child, bottom + A.GAP, key, depth + 1);
      bottom = size.bottom; right = Math.max(right, size.right);
    }
    return { bottom, right };
  };
  const size = walk(item, 0, from, 0);
  return { boxes, links, w: size.right, h: size.bottom };
}

// band: { key, adding, tasks: [{ id, stages: [{ id, sessions: [item] }] }], free: [{ folder, sessions: [item] }] }
//   item: { id, node(있으면 세션, 없으면 기록 없는 자리표), lines(카드 문장, model/agent-lines.js umapAgentLines), children: [item] } — children 은 그 에이전트가 띄운 서브에이전트(중첩 가능).
// width: 타일 캔버스 폭(px). 돌려주는 값: { key, boxes: { key: { x, y, w, h, band, kind, depth, manual } }, links: [{ from, to, kind }], width, height, wide }
// 같은 입력 → 같은 배치(배율과 무관).
function umapTileLayout(band, { manual = {}, width = UMAP.MIN_W } = {}) {
  const U = UMAP, A = UMAP_AGENT, boxes = [], links = [];
  const wide = width >= U.WIDE_W, pad = wide ? U.PAD : U.PAD_NARROW;
  const inner = Math.max(A.MIN_W, width - 2 * pad);
  const put = (key, kind, x, y, w, h, depth = 0) => { const box = { key, kind, x, y, w, h, depth, band: band.key, manual: false }; boxes.push(box); return box; };
  const place = (tree, x, y) => { for (const b of tree.boxes) put(b.key, b.kind, x + b.x, y + b.y, b.w, b.h, b.depth); links.push(...tree.links); };
  let cy = pad;
  if (band.adding) { put("add:" + band.key, "add", pad, cy, inner, U.ADD_H - 10); cy += U.ADD_H; }
  for (const task of band.tasks || []) {
    const taskKey = umapTaskKey(task.id);
    put(taskKey, "task", pad, cy, wide ? U.TASK_W : inner, U.TASK_H);
    // 넓으면 Task 카드 오른쪽에서, 좁으면 Task 카드 아래에서 단계를 시작한다. 폭이 차면 다음 줄(좁으면 단계마다 한 줄).
    const left = wide ? U.STAGE_X : pad, right = width - pad, gap = wide ? U.ROW_GAP : U.STACK_GAP;
    let x = left, top = wide ? cy : cy + U.TASK_H + U.STACK_GAP, bottom = cy + U.TASK_H, previous = taskKey;
    for (const [index, stage] of (task.stages || []).entries()) {
      const key = umapStageKey(task.id, stage.id);
      const trees = (stage.sessions || []).map((item) => umapTree(item, wide ? Infinity : inner, key));
      // 단계 칸은 그 아래 에이전트 나무 폭만큼 넓어진다(다음 단계와 겹치지 않는다). 좁은 타일에서는 타일 폭 전체.
      const colW = wide ? Math.max(U.STAGE_W, ...trees.map((tree) => tree.w)) : inner;
      if (x > left && x + colW > right) { x = left; top = bottom + gap; }
      put(key, "stage", x, top, colW, U.STAGE_H);
      links.push({ from: previous, to: key, kind: index ? "flow" : "start" });
      previous = key;
      let sy = top + U.STAGE_H + U.SESS_TOP;
      for (const tree of trees) { place(tree, x, sy); sy += tree.h + A.GAP; }
      bottom = Math.max(bottom, trees.length ? sy - A.GAP : top + U.STAGE_H);
      x += colW + U.STAGE_GAP;
    }
    cy = bottom + U.ROW_GAP;
  }
  if (!(band.tasks || []).length && !(band.free || []).length && !band.adding) { put("empty:" + band.key, "empty", pad, cy, Math.min(520, inner), U.EMPTY_H - 10); cy += U.EMPTY_H; }
  // Task 없이 연 세션: 폴더별 한 줄 제목 + 세션마다 에이전트 나무 하나를 타일 폭 안에서 줄바꿈.
  for (const group of band.free || []) {
    const folderKey = "folder:" + band.key + ":" + group.folder;
    put(folderKey, "folder", pad, cy, Math.min(inner, 900), U.LABEL_H - 6);
    cy += U.LABEL_H;
    let x = pad, rowH = 0;
    for (const item of group.sessions) {
      const tree = umapTree(item, inner, folderKey);
      if (x > pad && x + tree.w > width - pad) { cy += rowH + U.FREE_GAP; x = pad; rowH = 0; }
      place(tree, x, cy);
      x += tree.w + U.FREE_GAP; rowH = Math.max(rowH, tree.h);
    }
    cy += rowH + U.ROW_GAP;
  }
  // 옮긴 카드: 같은 타일이면 저장한 자리에 둔다(타일 폭이 줄었으면 캔버스 안으로 당긴다).
  let outW = width, outH = Math.max(pad * 2, cy - U.ROW_GAP + pad);
  for (const box of boxes) {
    const spot = manual[box.key];
    if (spot && spot.band === band.key && Number.isFinite(spot.dx) && Number.isFinite(spot.dy)) {
      box.x = Math.max(0, Math.min(spot.dx, width - box.w)); box.y = Math.max(0, spot.dy); box.manual = true;
    }
    outW = Math.max(outW, box.x + box.w);
    outH = Math.max(outH, box.y + box.h + pad);
  }
  const byKey = Object.fromEntries(boxes.map((box) => [box.key, box]));
  // 자유 세션의 첫 선(폴더 제목 → 세션)은 그리지 않는다.
  return { key: band.key, boxes: byKey, links: links.filter(({ from, to }) => byKey[from] && byKey[to] && !from.startsWith("folder:")), width: outW, height: outH, wide };
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
// 끌어 놓은 자리 → 끼울 자리. spots(단계 칸의 왼쪽 위 {x,y} 또는 x 숫자)를 주면 가장 가까운 칸(단계가 줄을 넘겨도 맞는다), 없으면 기본 칸 폭으로 센다.
function umapDropIndex(x, count, spots, y = 0) {
  if (Array.isArray(spots) && spots.length) {
    const dist = (spot) => (typeof spot === "number" ? Math.abs(x - spot) : Math.hypot(x - spot.x, y - spot.y));
    return Math.max(0, Math.min(count - 1, spots.reduce((best, spot, i) => (dist(spot) < dist(spots[best]) ? i : best), 0)));
  }
  return Math.max(0, Math.min(count - 1, Math.round((x - UMAP.STAGE_X) / (UMAP.STAGE_W + UMAP.STAGE_GAP))));
}
// Workflow 편집의 ＋ 자리(캔버스 좌표): 맨 앞, 단계 사이, 맨 뒤. 단계가 다음 줄로 넘어간 자리는 그 단계 왼쪽에 둔다.
function umapEditSpots(stageBoxes, taskBox) {
  const U = UMAP, mid = (box) => box.y + U.STAGE_H / 2 - 13;
  if (!stageBoxes.length) return taskBox ? [{ x: taskBox.x + taskBox.w + 16, y: taskBox.y + U.TASK_H / 2 - 13 }] : [];
  const spots = [{ x: stageBoxes[0].x - 32, y: mid(stageBoxes[0]) }];
  for (const [i, box] of stageBoxes.entries()) {
    const next = stageBoxes[i + 1];
    if (!next) spots.push({ x: box.x + box.w + 16, y: mid(box) });
    else if (next.y === box.y) spots.push({ x: (box.x + box.w + next.x) / 2 - 13, y: mid(box) });
    else spots.push({ x: next.x - 32, y: mid(next) });
  }
  return spots;
}

// 전체 보기: 내용(content {width,height})을 화면(view {width,height})에 맞추는 배율·위치. 작은 내용은 max 까지 키우고 가운데에 둔다.
// 관제 벽의 전체 보기는 max = 1 로 부른다(벽은 이미 화면 폭에 맞춰져 있어 보통 그대로 다 보인다).
function umapFitView(content, view, { min = 0.2, max = 1.25, pad = 24, height = true } = {}) {
  if (!(content.width > 0 && content.height > 0)) return { x: pad, y: pad, k: 1 }; // 그릴 것이 없으면 100%
  const cw = content.width, ch = content.height;
  const fit = Math.min((view.width - pad * 2) / cw, height ? (view.height - pad * 2) / ch : Infinity);
  const k = Math.round(Math.min(max, Math.max(min, fit)) * 1000) / 1000;
  const x = cw * k <= view.width - pad * 2 ? (view.width - cw * k) / 2 : pad;
  return { x: Math.round(x), y: pad, k };
}
