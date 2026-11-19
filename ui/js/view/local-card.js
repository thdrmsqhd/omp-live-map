/* omp-live-map · view · 로컬 카드 만들기(빈 바탕 메뉴·Ctrl+N) */

// only: 블록 하나만 가진 카드로 만들 때의 블록 타입(예: "browser"). 기본 블록 대비 차이로 저장한다.
function addLocal(x, y, only, title) {
  const id = "local_" + Date.now().toString(36) + "_" + (localSeq++);
  LOCALS.push({ id, title: title || "로컬 작업 " + (LOCALS.length + 1), cwd: ENV.localCwd || ENV.home || "", x, y, createdAt: Date.now() });
  saveLocals();
  if (only) {
    const base = BLOCK_DEFAULTS({ kind: "local" });
    CARD_BLOCKS.set(id, { add: base.includes(only) ? [] : [only], remove: base.filter((t) => t !== only) });
    saveBlocks();
  }
  openNode(id);
}

const addBrowserCard = (x, y) => addLocal(x, y, "browser", "브라우저 " + (LOCALS.filter((l) => /^브라우저 \d+$/.test(l.title)).length + 1));

