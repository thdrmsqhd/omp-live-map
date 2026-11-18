/* omp-live-map · model · 하네스(세션 실행기) 표시와 기능 플래그
   서버 스냅샷의 DATA.harness 표(omp·claude)를 그대로 쓴다. 카드의 node.harness 로 찾는다. */

const HARNESS_FALLBACK = {
  omp: { id: "omp", label: "omp", model: true, compact: true, clear: true, ask: true, attach: true, context: true, resume: true },
  claude: { id: "claude", label: "Claude", model: true, compact: true, clear: true, ask: true, attach: true, context: false, resume: true },
};

function capsOf(n) {
  const table = (DATA && DATA.harness) || {};
  const id = (n && n.harness) || "omp";
  return table[id] || HARNESS_FALLBACK[id] || HARNESS_FALLBACK.omp;
}

const harnessLabel = (n) => capsOf(n).label;

function harnessChip(n) {
  const c = capsOf(n);
  return `<span class="hz${c.id === "claude" ? " cl" : ""}" title="실행 하네스: ${esc(c.label)}">${esc(c.label)}</span>`;
}
