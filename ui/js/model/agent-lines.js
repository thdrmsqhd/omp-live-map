/* omp-live-map · model · 맵의 에이전트·서브에이전트 카드에 쓰는 문장. 서버 활동 요약(act, server/activity.js summary) → 한국어 줄.
   카드는 배율과 상관없이 늘 같은 내용·같은 크기다(의미 확대 없음, 확대·축소는 길찾기용). 접기·펼치기도 없다.
   DOM·전역 상태 접근 없음(별칭·답 대기·하네스 이름은 인자로 받는다). 카드 높이도 여기서 정해 umapTileLayout 과 그리기가 같은 값을 쓴다. */

const UMAP_AGENT = Object.freeze({ W: 380, MIN_W: 260, PAD: 18, HEAD: 26, ROW: 21, RECENT: 3, INDENT: 36, GAP: 14, MISSING_H: 36 });
const UMAP_AGENT_STATE = Object.freeze({
  running: { label: "실행 중", color: "#4aa8ff" }, done: { label: "완료", color: "#2fbf9b" },
  failed: { label: "실패", color: "#e3564f" }, waiting: { label: "대기", color: "#8a9bb0" }, ask: { label: "답 필요", color: "#e0a83c" },
});
// 툴 이름(omp 소문자 · Claude Code 대문자) → 한 일. 읽기·수정·명령·찾기·서브에이전트는 서버가 kind 로 나눠 준다.
const UMAP_TOOL_KO = Object.freeze({
  todowrite: "할 일 목록 정리", todo_write: "할 일 목록 정리", todo: "할 일 목록 정리", ask: "사용자에게 질문", askuserquestion: "사용자에게 질문",
  exitplanmode: "계획 제출", enterplanmode: "계획 세우기", yield: "결과 제출", submit_result: "결과 제출", lsp: "코드 정의 조회",
  notebookedit: "노트북 수정", skill: "스킬 불러옴", python: "파이썬 실행", browser: "브라우저 조작", puppeteer: "브라우저 조작",
});
const UMAP_TEST_CMD = /(^|[\s;&|])(node\s+--test|npm\s+(run\s+)?t(est)?|pnpm\s+(run\s+)?test|yarn\s+test|npx\s+(jest|vitest|mocha)|jest|vitest|mocha|pytest|python\s+-m\s+(pytest|unittest)|go\s+test|cargo\s+test|mvn\S*\s+test|gradle\S*\s+test|dotnet\s+test|deno\s+test|bun\s+test)\b/i;

const umapBaseName = (file) => String(file || "").split(/[\\/]/).filter(Boolean).pop() || String(file || "");
// 한 줄로 자른다. 마크다운 강조(**·`)와 제목 표시(#)는 뺀다.
const umapClip = (text, n = 60) => {
  const s = String(text ?? "").replace(/\*\*|__|`/g, "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
// 명령 줄 → 보여 줄 짧은 명령: 앞의 cd …&&·환경 변수 대입을 빼고, powershell -Command "…" 는 안쪽 명령, 이어진 명령은 첫 토막만.
function umapCmdName(cmd) {
  let s = String(cmd || "").replace(/\s+/g, " ").trim();
  const ps = /^(?:powershell|pwsh)(?:\.exe)?\s.*?-Command\s+(?:"([^"]*)"?|'([^']*)'?|(.+))/i.exec(s);
  if (ps) s = (ps[1] ?? ps[2] ?? ps[3] ?? "").trim();
  s = s.replace(/^(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/i, "").replace(/^([A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+)+/, "");
  s = s.split(/\s*(?:&&|\|\||;|\|)\s*/)[0] || s;
  return umapClip(s.replace(/^\\?\$\w+\s*=\s*/, ""), 44);
}
const umapIsTest = (cmd) => UMAP_TEST_CMD.test(" " + String(cmd || ""));
// mcp__서버__툴 → '서버 툴'
const umapToolName = (tool) => String(tool || "").replace(/^mcp__([^_]+(?:_[^_]+)*)__/, "$1 ").replace(/_/g, " ");
const umapToolKo = (tool) => UMAP_TOOL_KO[String(tool || "").toLowerCase()] || "";
const umapLines = (add, del, write) => (write ? `(+${add || 0})` : `(+${add || 0} −${del || 0})`);

// 활동 하나(act.recent 항목) → 지난 일 한 문장. 발화·지시처럼 '한 일'이 아닌 것은 "" 다.
function umapActionLine(it) {
  if (!it) return "";
  const file = umapBaseName(it.file), cmd = umapCmdName(it.cmd || String(it.text || "").replace(/^명령 [✓✗]? ?/, ""));
  switch (it.kind) {
    case "read": return file + " 읽음";
    case "edit": return file + (it.more ? ` 외 ${it.more}개` : "") + (it.write ? " 새로 씀 " : " 고침 ") + umapLines(it.add, it.del, it.write);
    case "command":
      if (umapIsTest(cmd)) return it.ok === true ? cmd + " 통과" : it.ok === false ? cmd + " 실패" : cmd + " 실행";
      return it.ok === false ? cmd + " 실패" : it.ok === true ? cmd + " 실행함" : cmd + " 실행";
    case "search": return `‘${umapClip(it.query || String(it.text || "").replace(/^찾기 ?/, ""), 36)}’ 찾아봄`;
    case "spawn": {
      if (it.n === 0) return "서브에이전트에 후속 지시";
      const names = it.names || [];
      if (names.length > 1) return `서브에이전트 ${names.length}개를 띄움 (${umapClip(names.join(", "), 34)})`;
      if (names.length === 1) return names[0] + " 서브에이전트를 띄움";
      return `‘${umapClip(it.desc || "", 34)}’ 서브에이전트를 띄움`;
    }
    case "result": {
      const who = it.who || "서브에이전트";
      return /fail|error|abort|cancel|timeout/i.test(it.status || "") ? who + " 실패를 보고받음" : who + " 결과를 받음";
    }
    case "tool": return umapToolKo(it.tool) || (it.tool ? umapToolName(it.tool) + " 사용" : "");
    default: return "";
  }
}
// 지금 도는 일(act.now) → '…중' 한 문장.
function umapNowLine(it, waitingSubs = 0) {
  if (!it) return "";
  const file = umapBaseName(it.file);
  switch (it.kind) {
    case "read": return file + " 읽는 중";
    case "edit": return file + " 수정 중";
    case "command": return (umapIsTest(it.cmd) ? "테스트 실행 중 · " : "") + umapCmdName(it.cmd) + (umapIsTest(it.cmd) ? "" : " 실행 중");
    case "search": return `‘${umapClip(it.query || "", 36)}’ 찾는 중`;
    case "spawn": return it.n === 0 ? "서브에이전트에 후속 지시 중" : `서브에이전트 ${waitingSubs || it.n || 1}개 대기`;
    default: return (umapToolKo(it.tool) || (it.tool ? umapToolName(it.tool) : "툴") + " 사용") + " 중";
  }
}

// 카드 제목: 별칭 → 세션 제목 → 첫 지시 → 하네스 이름(절대 '에이전트'만 쓰지 않는다). 서브는 기록 이름(Fixer 등).
function umapAgentTitle(n, { alias = "", harness = "" } = {}) {
  if (alias) return alias;
  if (n.kind === "sub") return n.name || n.agent || (harness ? harness + " 서브에이전트" : "서브에이전트");
  return n.sessionTitle || n.title || n.firstUser || (harness ? harness + " 세션" : "세션");
}
const UMAP_NODE_STATE = { live: "running", done: "done", idle: "waiting" };

// 노드 → 카드에 쓸 줄 전부. { title, sub, state, goal, now, result, recent: [{ text, ts, file, bad }], counters }
function umapAgentLines(n, { alias = "", ask = false, harness = "" } = {}) {
  const act = n.act || {};
  const state = ask ? "ask" : act.status || UMAP_NODE_STATE[n.status] || "waiting";
  const finished = state === "done" || state === "failed";
  const goalText = act.goal || n.firstUser || "";
  let now = "";
  if (state === "ask") now = "선택을 기다림 · 답이 필요합니다";
  else if (state === "running") now = act.now ? umapNowLine(act.now, act.waitingSubs) : act.currentActivity || "생각 중";
  else if (state === "waiting") now = "다음 지시를 기다리는 중";
  const result = finished ? (state === "failed" ? "실패 · " : "") + (act.resultSummary || "(요약 없음)") : "";
  // 최근 한 일 3개(오래된 것 → 최근). 지금 도는 일은 '지금' 줄에 있으므로 뺀다.
  const nowKey = act.now ? act.now.ts + "|" + act.now.text : "";
  const recent = [];
  for (const it of (act.recent || []).slice().reverse()) {
    if (recent.length >= UMAP_AGENT.RECENT) break;
    if (nowKey && it.ts + "|" + it.text === nowKey) continue;
    const text = umapActionLine(it);
    if (text) recent.unshift({ text, ts: it.ts || 0, file: it.kind === "edit" ? it.file || "" : "", bad: it.ok === false });
  }
  const c = act.counts || {}, parts = [];
  if (c.reads) parts.push("읽음 " + c.reads);
  if ((act.edits || []).length) parts.push(`수정 ${act.edits.length}파일 (+${c.add || 0} −${c.del || 0})`);
  if (c.commands) parts.push(`명령 ${c.commands}` + (c.ok || c.fail ? ` (✓${c.ok || 0} ✗${c.fail || 0})` : ""));
  return {
    title: umapAgentTitle(n, { alias, harness }), sub: n.kind === "sub", state, label: UMAP_AGENT_STATE[state].label, color: UMAP_AGENT_STATE[state].color,
    goal: goalText ? umapClip(goalText, 120) : "(지시 기록 없음)", now, result: umapClip(result, 140), recent, counters: parts.join(" · "),
  };
}
// 카드 높이: 머리 + 목표 + 지금/결과 + 최근 한 일(0~3) + 카운터 한 줄. lines 가 없으면 최근 3줄이 다 찬 높이.
function umapAgentHeight(lines) {
  const rows = 2 + (lines ? lines.recent.length : UMAP_AGENT.RECENT) + (lines && !lines.counters ? 0 : 1);
  return UMAP_AGENT.PAD + UMAP_AGENT.HEAD + rows * UMAP_AGENT.ROW;
}
