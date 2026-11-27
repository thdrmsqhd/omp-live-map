/* omp-live-map · view · 새 세션 자리표시 카드 (요청한 지도 좌표에 '여는 중' 카드를 그린다) */
//
// 카드가 실제로 그려지기 전까지(#nodes 안의 지도 레이어) 사용자가 새 카드가 생길 자리를 보게 한다.
// renderMap 은 #nodes 자식을 전부 갈아 끼우므로 자리표시를 piece 로 넘겨 매 렌더마다 다시 그린다.

const PENDS = [];            // { id, x, y, cwd, node, err, wait, timer }
const PEND_TIMEOUT = 45000;  // 응답이 와도 카드가 안 보이면 이만큼 기다린 뒤 오류로 바꾼다

// at(지도 좌표)이 없으면 화면 중앙 근처에 놓는다.
function pendingSpot(at) {
  if (at && isFinite(at.x) && isFinite(at.y)) return { x: at.x, y: at.y };
  const r = $("stage").getBoundingClientRect();
  const p = worldPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { x: p.x - AG.W / 2, y: p.y - 60 };
}

function folderName(cwd) {
  const parts = String(cwd || "").split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (cwd || "작업 폴더 미지정");
}

// 창을 닫았어도 요청은 살아 있으므로 자리표시는 따로 관리한다.
function addPending(at, cwd) {
  const spot = pendingSpot(at);
  const p = { id: "pend_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), x: spot.x, y: spot.y, cwd: cwd || "", node: null, err: "", wait: "", timer: 0 };
  p.timer = setTimeout(() => {
    if (PENDS.indexOf(p) < 0) return;
    p.err = "카드가 아직 나타나지 않았습니다 (서버 상태를 확인해 보세요)";
    renderMap(false, true);
  }, PEND_TIMEOUT);
  PENDS.push(p);
  renderMap(false, true);
  return p;
}

function dropPending(p) {
  const i = PENDS.indexOf(p);
  if (i < 0) return;
  clearTimeout(p.timer);
  PENDS.splice(i, 1);
  if (!DEFER) renderMap(false, true); else pendingRender = true;
}

// postJSON 결과를 자리표시에 반영한다. 성공하면 카드 id 를 기억해 두고 카드가 그려질 때 사라진다.
// 서버가 실행을 대기열에 넣었으면(queued) 대기 사유를 자리표시에 보여 주고 카드가 생길 때까지 둔다.
function settlePending(p, out) {
  if (!p || PENDS.indexOf(p) < 0) return;
  if (out && out.ok && out.queued) {
    p.node = out.node;
    p.wait = out.out || "실행 대기";
    clearTimeout(p.timer);
    renderMap(false, true);
    return;
  }
  if (out && out.ok) {
    if (out.node) { p.node = out.node; renderMap(false, true); return; }
    dropPending(p);
    return;
  }
  p.err = (out && out.out) || "세션을 열지 못했습니다";
  clearTimeout(p.timer);
  renderMap(false, true);
}

function pendingHTML(p) {
  const cwd = p.cwd || "작업 폴더 미지정";
  const tail = p.err
    ? `<div class="perr">${esc(p.err)}</div><div class="phint">클릭하여 닫기</div>`
    : p.wait
      ? `<div class="pwait">${esc(p.wait)}</div><div class="phint">자원이 확보되면 자동으로 시작합니다</div>`
      : `<div class="phint">카드가 나타나면 사라집니다</div>`;
  return `<div class="pendcard${p.err ? " err" : ""}" data-pend="${esc(p.id)}" style="left:${p.x}px;top:${p.y}px;width:${AG.W}px">
    <button class="px2" data-pendx="1" title="닫기" aria-label="닫기">✕</button>
    <div class="pt">${p.err ? `<i class="px">!</i>` : `<i class="sp"></i>`}${p.err ? "새 세션을 열지 못했습니다" : p.wait ? "실행 대기 중…" : "새 세션 여는 중…"}</div>
    <div class="pcwd" title="${esc(cwd)}">${esc(folderName(p.cwd))}</div>
    ${tail}
  </div>`;
}

// renderMap 조각 목록에 넣을 자리표시들. 해석된 카드가 이미 맵에 있으면 여기서 목록에서 뺀다.
function pendingPieces() {
  for (let i = PENDS.length - 1; i >= 0; i--) {
    const p = PENDS[i];
    if (!p.node) continue;
    if (NODES.some((n) => n.id === p.node)) { clearTimeout(p.timer); PENDS.splice(i, 1); }
  }
  return PENDS.map((p) => ({ key: "p:" + p.id, html: pendingHTML(p) }));
}

// 자리표시 클릭: 닫기 버튼은 언제나 닫고, 오류 카드는 카드 몸통 클릭으로도 닫는다.
// (서버가 성공을 돌려줬는데 카드가 끝내 나타나지 않는 경우도 사용자가 바로 치울 수 있어야 한다.)
$("nodes").addEventListener("click", (e) => {
  const el = e.target.closest(".pendcard");
  if (!el) return;
  const p = PENDS.find((x) => x.id === el.dataset.pend);
  if (!p) return;
  if (e.target.closest("[data-pendx]") || p.err) dropPending(p);
});
