/* omp-live-map · view · 큰 카드 지표 구역(토큰·컨텍스트·칩·자원 행) */

// 카드 펼침 상태(저장하지 않음 — 새로고침하면 접힌 상태로 돌아간다).
const CTX_OPEN = new Set();   // 세션 컨텍스트 목록 전체 표시: nodeId
const SUB_OPEN = new Set();   // 부제 2줄 표시: nodeId
const TOOLS_OPEN = new Set(); // 툴 칩 전체 표시: nodeId

// 토큰 바·범례·누적 지표. 바를 누르면 세션 누적 ↔ 최근 1시간으로 바뀐다.
function tokenSection(n) {
  const hour = TOK_SCOPE.get(n.id) === "1h" && n.tokens1h;
  const t = hour ? n.tokens1h : n.tokens;
  const scope = hour ? "최근 1시간" : "세션 누적";
  const requests = hour ? t.requests : n.requests;
  const cost = hour ? t.cost : n.cost;
  const aux = !hour && n.auxCost ? ` · 보조 모델(제목·판정 등) ${krw(n.auxCost)} 포함` : "";
  return `<div class="ibar tokbar" data-tokscope="${esc(n.id)}" title="클릭: 세션 누적 ↔ 최근 1시간">${tokenTape(t)}</div>
    ${tokenLegend(t)}
    <div class="nums" style="font-size:11px;gap:12px;margin-top:6px">
      <button class="tscope${hour ? " on" : ""}" data-tokscope="${esc(n.id)}" title="토큰·요청·비용의 집계 범위. 클릭해서 전환">${scope}</button>
      <u class="m-tok" title="${scope} 토큰(입력+출력+캐시읽기+캐시쓰기)">합계 <b>${fmt(t.total)}</b></u>
      <u class="m-req" title="${scope} 모델 호출 수${!hour && n.turns ? ` (사용자 턴 ${n.turns})` : ""}">요청 <b>${requests}</b></u>
      <u class="m-ctx" title="ttft · 요청부터 첫 토큰까지 평균 지연, 세션 누적${n.ttftN ? ` 표본 ${n.ttftN}회` : ""}">ttft <b>${n.avgTtft}ms</b>${n.ttftN ? ` <small>(${n.ttftN}회)</small>` : ""}</u>
      <u class="m-cost" title="${scope} 비용 $${(+cost || 0).toFixed(4)} (원화 환산)${aux}">cost <b>${krw(cost)}</b></u>
      <u class="${n.errors ? "m-warn m-err" : "m-off"}" title="오류 · 세션 누적 stopReason=error 응답 수${n.errors ? " — API 오류·요청 한도 초과·사용자 중단·네트워크 끊김 등. 유형은 채팅 로그에서 확인" : ""}">오류 <b>${n.errors}</b></u>
    </div>`;
}

// 누적 칩은 6개까지만 펼치고, 나머지는 한 줄 버튼으로 접는다.
function toolChips(n) {
  const tools = n.tools || [];
  const open = TOOLS_OPEN.has(n.id);
  const picked = CHAT_TOOL.get(n.id);
  const shown = open ? tools : tools.slice(0, 6);
  const chips = shown.map((t) => `<button class="chip t${picked === t.name ? " on" : ""}" data-tool="${esc(t.name)}" title="${esc(t.name)} ${t.count}회 · 마지막 사용 ${ago(t.lastTs)}${t.intent ? " · " + esc(t.intent) : ""} · 클릭: 대화에서 이 툴을 쓴 턴만 보기">${esc(t.name)} ${t.count}</button>`).join("");
  if (tools.length <= 6) return chips;
  return chips + `<button class="chip more" data-toolsmore="${esc(n.id)}" title="${open ? "툴 칩 접기" : esc(tools.slice(6).map((t) => t.name).join(" · "))}">${open ? "접기" : "+" + (tools.length - 6)}</button>`;
}

function progChips(prog) {
  if (!prog.length) return "";
  const rest = prog.slice(2);
  return `<span class="chip p" title="최근 터미널 명령에서 쓴 프로그램">터미널: ${esc(prog.slice(0, 2).join(" · "))}</span>`
    + (rest.length ? `<span class="chip p more" title="${esc(rest.join(" · "))}">+${rest.length}개</span>` : "");
}

// 컨텍스트 사용률. 모델의 상한(ctxWindow)을 모르면 null.
function ctxUsage(n) {
  const prompt = n.ctx && n.ctx.promptTokens;
  if (!prompt || !n.ctxWindow) return null;
  const pct = (prompt / n.ctxWindow) * 100;
  return { pct, text: pct < 1 ? "<1%" : Math.round(pct) + "%", level: pct >= 85 ? "err" : pct >= 70 ? "warn" : "ok" };
}

function ctxBlock(n) {
  const c = n.ctx;
  if (!c) return '<div class="kv" style="margin-top:6px">컨텍스트 기록 없음</div>';
  const prompt = c.promptTokens || 0;
  const nonMsg = c.nonMessageTokens || 0;
  const msgs = Math.max(0, prompt - nonMsg);
  const schema = c.toolSchemaTokens || 0;
  const overhead = Math.max(0, nonMsg - schema);
  const use = ctxUsage(n);
  // 상한을 알면 바 전체가 컨텍스트 윈도이고, 모르면 프롬프트 구성비만 보여 준다.
  const total = Math.max(1, use ? n.ctxWindow : prompt);
  const seg = (label, v, color) => v
    ? `<i title="${label} ${fmt(v)} tok (${pctText(v, prompt)})" style="width:${(v / total) * 100}%;background:${color}"></i>` : "";
  const th = (p) => `<b class="ctxth t${p}" style="left:${p}%" title="사용률 ${p}% 선"></b>`;
  const badge = (cls, title, text) => `<span class="ctxbadge${cls}" title="${title}">${text}</span>`;
  return `<div class="sec2 ctxhd">context ${fmt(prompt)}${use ? ` / ${fmt(n.ctxWindow)}` : ""} tok${use
    ? `<b class="ctxpct ${use.level}" title="프롬프트 토큰 ÷ 모델 컨텍스트 상한">${use.text}</b>`
    : badge("", "이 모델의 컨텍스트 상한을 찾지 못해 사용률을 계산하지 않습니다", "상한 미상")}${c.compactionEpoch
    ? badge("", "이 agent 의 컨텍스트 압축 횟수", `압축 ${c.compactionEpoch}회`) : ""}${use && use.level === "err"
    ? badge(" ctxerr", "컨텍스트 상한의 85%를 넘었습니다. 곧 압축되거나 요청이 거절될 수 있습니다", "상한 임박") : ""}${prompt && nonMsg / prompt > 0.6
    ? badge(" ctxwarn", `시스템+툴 스키마 ${fmt(nonMsg)} tok = 프롬프트의 ${pctText(nonMsg, prompt)} — 대화보다 고정 오버헤드가 큼`, "시스템 비중 높음") : ""}</div>
    <div class="ibar ctxbar">
      ${seg("대화", msgs, "#4aa8ff")}${seg("툴 스키마", schema, "#a98bff")}${seg("시스템", overhead, "#475f74")}
      ${use ? th(70) + th(85) : ""}
    </div>
    <div class="nums" style="font-size:9.5px">
      <u class="m-ctx">대화 <b>${fmt(msgs)}</b><small>${pctText(msgs, prompt)}</small></u>
      <u class="m-req">툴 스키마 <b>${fmt(schema)}</b><small>${pctText(schema, prompt)}</small></u>
      <u class="m-cache">시스템 <b>${fmt(overhead)}</b><small>${pctText(overhead, prompt)}</small></u>
    </div>`;
}

function sessionCtxBlock(n) {
  const cl = CLUSTERS.find((c) => c.kind === "session" && c.key === n.session);
  if (!cl || !cl.ctxParts || cl.ctxParts.length < 2) return "";
  const max = Math.max(...cl.ctxParts.map((p) => p.tok), 1);
  const open = CTX_OPEN.has(n.id);
  const TOP = 3;   // 접힌 상태에서 보일 행 수(큰 카드 크롬이 블록 자리를 덜 먹게)
  const rest = cl.ctxParts.length - TOP;
  const rows = open ? cl.ctxParts : cl.ctxParts.slice(0, TOP);
  return `<div class="sec2" style="margin-top:7px">세션 컨텍스트 · 토큰순 · ${cl.ctxParts.length} agent</div>
    ${rows.map((p) => `<button class="tbar${p.id === n.id ? " me" : ""}" data-ctxnode="${esc(p.id)}" title="${esc(p.name)} · ${fmt(p.tok)} tok (${pctText(p.tok, cl.ctxTotal)}) · 클릭: 이 카드로 이동">
      <span class="tn">${esc(cut(p.name, 14))}</span>
      <span class="tb"><i style="width:${Math.max(3, (p.tok / max) * 100)}%"></i></span>
      <span class="tv">${p.id === n.id ? "" : fmt(p.tok)}</span></button>`).join("")}
    ${rest > 0 ? `<button class="ctxmore" data-ctxmore="${esc(n.id)}">${open ? "접기" : `나머지 ${rest}개`}</button>` : ""}`;
}

const cpuLevel = (cpu) => (cpu >= 85 ? "cpu-err" : cpu >= 60 ? "cpu-warn" : "cpu-ok");

function resRow(n, wide) {
  const r = n.res;
  if (!r) return "";
  if (!r.proc) {
    const sh = r.shared || { cpu: 0, mb: 0, proc: 0 };
    return `<div class="resrow"><span style="color:#5c7186">세션 전용 프로세스 없음 · 공유</span>
      <span class="rr-cpu" title="공유 프로세스(bash·node·python·wsl·docker 등) CPU 합계">CPU <b>${sh.cpu}%</b></span>
      <span class="rr-mem" title="공유 프로세스 메모리 합계"><b>${memSize(sh.mb)}</b></span>
      <span title="공유 프로세스 ${sh.proc}개">${sh.proc}p</span></div>`;
  }
  const procs = r.procs || [];
  const names = procs.map((p) => `${p.name}(${p.pid}) ${p.cpu}% ${memSize(p.mb)}`).join("\n");
  const more = r.proc > procs.length ? `\n… 외 ${r.proc - procs.length}개` : "";
  const trend = miniSpark(r.hist, 44, 10, "#ff9f6b");
  return `<div class="resrow">
    <span class="rr-cpu" title="세션 프로세스 트리 CPU 합계(코어 합산)">CPU <b>${r.cpu}%</b></span>
    ${trend ? `<span class="rr-hist" title="최근 약 40초 CPU 추세">${trend}</span>` : ""}
    <span class="rbar"><i class="${cpuLevel(r.cpu)}" style="width:${Math.max(2, Math.min(100, r.cpu))}%"></i></span>
    <span class="rr-mem" title="세션 프로세스 메모리 합계 ${memSize(r.mb)}\n${esc(names)}"><b>${memSize(r.mb)}</b></span>
    <span title="프로세스 ${r.proc}개\n${esc(names + more)}">${r.proc}p</span>
    ${wide ? `<span style="margin-left:auto;color:#5c7186">${procs.map((p) => esc(p.name)).join(" · ")}</span>` : ""}
  </div>`;
}

// 헤더 상태 점 툴팁: 상태·마지막 활동·시작·프로세스.
function dotTitle(n) {
  const procs = (n.res && n.res.procs) || [];
  const parts = [n.status, "마지막 " + ago(n.lastTs)];
  if (n.startedAt) parts.push("시작 " + new Date(n.startedAt).toLocaleString("ko-KR"));
  if (n.res && n.res.proc) parts.push(`프로세스 ${n.res.proc}개 (pid ${procs.slice(0, 4).map((p) => p.pid).join(", ")}${n.res.proc > 4 ? " …" : ""})`);
  return parts.join(" · ");
}
