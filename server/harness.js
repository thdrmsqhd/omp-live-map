// 하네스 등록부: 세션을 만든 실행기(omp·Claude Code)별 표시 이름과 카드 기능 플래그. 상태는 없다.
// UI 는 스냅샷 노드의 harness 값과 이 표만 보고 omp 전용 버튼을 숨기거나 잠근다. 새 하네스는 여기 한 줄과
// server/harness/<name>.js 어댑터를 더한다(경계: 읽기=scan/stateOf, 실행=prompt/cancel/stop).
"use strict";

const path = require("path");
const { CLAUDE_PROJECTS } = require("./config");

const HARNESSES = {
  omp: { id: "omp", label: "omp", model: true, compact: true, clear: true, ask: true, attach: true, context: true, resume: true },
  claude: { id: "claude", label: "Claude", model: true, compact: true, clear: true, ask: true, attach: true, context: false, resume: true },
};

const norm = (p) => path.normalize(String(p || "")).toLowerCase();
const CLAUDE_ROOT = norm(CLAUDE_PROJECTS) + path.sep;

// 이 기록 경로를 만든 하네스. ~/.claude/projects 아래면 Claude Code, 나머지는 omp.
function of(file) {
  return norm(file).startsWith(CLAUDE_ROOT) ? "claude" : "omp";
}

const capsOf = (id) => HARNESSES[id] || HARNESSES.omp;

module.exports = { HARNESSES, of, capsOf };
