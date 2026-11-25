// 턴 기록: 노드 메시지 목록(툴 태그·툴 전용 턴 병합, MSG_KEEP)과 최근 1시간 토큰 버퍼.
"use strict";

const { MSG_KEEP } = require("./config");
const { invalidateMessageSize } = require("./msg-cap");
const { resultsOf, CALL_MAX } = require("./agent-msgs");

const HOUR_MS = 3_600_000;
const TOOL_TAGS = 12; // 툴 전용 병합 항목의 tools 최대 개수
const EMPTY_TEXT = /^[.·,\s]*$/;
const MSG_TEXT_MAX = 64000; // 기록 메시지 한 건의 글자 수. 줄바꿈은 지켜야 대화 블록 markdown 이 살아난다.
const keepText = (t) => t.replace(/\r\n?/g, "\n").trim().slice(0, MSG_TEXT_MAX);

function pushMessage(st, msg) {
  st.messageSeq=(st.messageSeq||0)+1;msg.id=String(st.sessionId||st.id||st.file||"session")+":"+st.messageSeq;
  st.messages.push(msg);
  if (st.messages.length > MSG_KEEP) st.messages = st.messages.slice(-MSG_KEEP);
}

function recordUser(st, text, ts, images) {
  const t = keepText(text);
  const imgs = Array.isArray(images) ? images : [];
  // 이미지만 있는 메시지도 대화 기록에 남긴다.
  if (!t && !imgs.length) return;
  const msg = { role: "user", text: t, ts };
  if (imgs.length) msg._imgs = imgs; // 스냅샷에서 images [{mime,url}] 로 바뀐다.
  pushMessage(st, msg);
}

// said: 본문 텍스트, tools: 이 턴의 toolCall 이름(중복 제거됨). 기록한 메시지를 돌려준다
// (Claude 기록은 한 API 메시지가 블록별 줄로 쪼개져 와서 같은 메시지에 이어 붙인다).
// calls: 서브에이전트 호출 카드(agent-msgs.callsOf). 같은 메시지에 붙인다.
function recordAssistant(st, said, tools, ts, calls) {
  if (said && !EMPTY_TEXT.test(said)) {
    st.lastAssistant = said.replace(/\s+/g, " ").slice(0, 300);
    const msg = { role: "assistant", text: keepText(said), ts };
    if (tools.length) msg.tools = [...new Set(tools)];
    if (calls && calls.length) msg.calls = calls;
    pushMessage(st, msg);
    return msg;
  }
  if (!tools.length) return null; // 도구 호출도 본문도 없는 턴은 기록하지 않는다.
  const prev = st.messages[st.messages.length - 1];
  if (prev && prev.role === "assistant" && prev.text === "" && prev.n) {
    prev.n += 1;
    prev.tools = [...new Set([...prev.tools, ...tools])].slice(0, TOOL_TAGS);
    prev.ts = ts;
    if (calls && calls.length) prev.calls = [...(prev.calls || []), ...calls].slice(-CALL_MAX);
    invalidateMessageSize(prev);
    return prev;
  }
  const msg = { role: "assistant", text: "", ts, tools: tools.slice(0, TOOL_TAGS), n: 1 };
  if (calls && calls.length) msg.calls = calls;
  pushMessage(st, msg);
  return msg;
}

// 서브에이전트 결과 안내문 → role "result" 메시지. 몇 건 기록했는지 돌려준다(0 이면 일반 글).
function recordResults(st, text, ts) {
  const rs = resultsOf(text);
  for (const r of rs) pushMessage(st, { role: "result", ...r, ts });
  return rs.length;
}

// assistant 턴 사용량을 쌓고, 이 턴 ts 기준 1시간보다 오래된 항목을 버린다.
function noteHourly(st, u, ts) {
  const x = u || {};
  st.hourly.push({
    ts,
    input: x.input || 0,
    output: x.output || 0,
    cacheRead: x.cacheRead || 0,
    cacheWrite: x.cacheWrite || 0,
    total: x.totalTokens || 0,
    cost: (x.cost && x.cost.total) || 0,
  });
  const floor = ts - HOUR_MS;
  if (st.hourly[0].ts < floor) st.hourly = st.hourly.filter((h) => h.ts >= floor);
}

function sumHourly(st, now) {
  const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, requests: 0 };
  const since = now - HOUR_MS;
  for (const h of st.hourly || []) {
    if (h.ts < since) continue;
    acc.input += h.input;
    acc.output += h.output;
    acc.cacheRead += h.cacheRead;
    acc.cacheWrite += h.cacheWrite;
    acc.total += h.total;
    acc.cost += h.cost;
    acc.requests += 1;
  }
  return acc;
}

module.exports = { recordResults, recordUser, recordAssistant, noteHourly, sumHourly, keepText };
