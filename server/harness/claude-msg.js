// Claude Code 기록 한 줄(assistant·user)을 omp 와 같은 메시지 모양으로 바꾼다.
// 한 API 메시지가 thinking·text·tool_use 블록별 줄로 쪼개져 오므로 message.id 로 묶어 한 턴 메시지로 합치고,
// 사용량은 메시지당 한 번만 센다. 하네스가 끼워 넣은 isMeta 사용자 줄은 사용자 발화가 아니다.
"use strict";

const { recordUser, recordAssistant, noteHourly, keepText } = require("../turns");
const { invalidateMessageSize } = require("../msg-cap");

// assistant usage → omp 가 쓰는 모양. 캐시 생성·읽기는 새 입력과 별도 토큰이다.
function usageOf(u) {
  const x = u || {};
  const input = x.input_tokens || 0, output = x.output_tokens || 0;
  const cacheRead = x.cache_read_input_tokens || 0, cacheWrite = x.cache_creation_input_tokens || 0;
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite };
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join(" ");
}

const blocksOf = (m) => (Array.isArray(m.content) ? m.content : []);
const textsIn = (blocks) => blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text);
const toolsIn = (blocks) => blocks.filter((b) => b && b.type === "tool_use" && b.name).map((b) => b.name);

function noteTool(st, name, input, ts) {
  const cur = st.tools.get(name) || { count: 0, lastTs: 0, intent: "" };
  cur.count += 1;
  cur.lastTs = ts || cur.lastTs;
  st.tools.set(name, cur);
  const a = input && typeof input === "object" ? input : {};
  if (typeof a.command === "string") st.commands = [{ cmd: a.command.slice(0, 140), ts }, ...st.commands].slice(0, 8);
  if (typeof a.file_path === "string" && a.file_path.length < 400) {
    st.files = [{ p: a.file_path, ts }, ...st.files.filter((f) => f.p !== a.file_path)].slice(0, 12);
  }
}

// 같은 API 메시지의 다음 블록 줄: 사용량·턴은 다시 세지 않고 이미 기록한 메시지에 이어 붙인다.
function mergeAssistant(st, said, tools, ts) {
  const msg = st.msgRef;
  if (!msg) { st.msgRef = recordAssistant(st, said, tools, ts); return; }
  if (said) {
    const text = keepText(said);
    if (text) {
      msg.text = msg.text ? msg.text + "\n" + text : text;
      st.lastAssistant = text.replace(/\s+/g, " ").slice(0, 300);
    }
  }
  if (tools.length) msg.tools = [...new Set([...(msg.tools || []), ...tools])].slice(0, 12);
  msg.ts = ts;
  invalidateMessageSize(msg);
}

function onAssistant(st, o, ts) {
  const m = o.message || {};
  const blocks = blocksOf(m);
  const said = textsIn(blocks).join(" ");
  const tools = toolsIn(blocks);
  // omp 와 같은 규칙: 마지막 assistant 가 툴 호출 없이 끝났으면 한 턴이 끝난 것이다.
  st.turnOver = m.stop_reason !== "tool_use";
  if (m.model) st.model = m.model;
  const id = m.id || o.requestId || "";
  if (id && id === st.msgId) { mergeAssistant(st, said, tools, ts); return; }
  st.msgId = id;
  st.msgRef = null;
  const u = usageOf(m.usage);
  st.requests += 1;
  st.usage.input += u.input;
  st.usage.output += u.output;
  st.usage.cacheRead += u.cacheRead;
  st.usage.cacheWrite += u.cacheWrite;
  st.usage.total += u.totalTokens;
  noteHourly(st, u, ts);
  if (st.lastTs && ts > st.lastTs) {
    const dur = Math.min(600_000, ts - st.lastTs);
    st.durationSum += dur;
    st.recent.push({ ts, out: u.output, dur });
    if (st.recent.length > 30) st.recent.shift();
  }
  // 컨텍스트 프롬프트 = 캐시 읽기 + 캐시 생성 + 새 입력. 구성 비율은 Claude 기록에 없어 0 으로 둔다.
  st.ctx = { promptTokens: u.input + u.cacheRead + u.cacheWrite, nonMessageTokens: 0, toolSchemaTokens: 0, compactionEpoch: 0 };
  for (const b of blocks) if (b && b.type === "tool_use" && b.name) noteTool(st, b.name, b.input, ts);
  st.msgRef = recordAssistant(st, said, [...new Set(tools)], ts);
}

function onUser(st, o, ts) {
  // sidechain 레코드는 서브에이전트 기록 파일의 본문이다. 메인 파일에 섞여 오면 버린다.
  if (o.isSidechain && !st.sidechain) return;
  // 하네스가 끼워 넣은 지시·스킬 본문(isMeta)·기록 전용 항목은 사용자 발화가 아니다.
  // omp 는 같은 내용을 toolResult 로 남기므로 사용자 메시지로 올리면 대화가 달라진다.
  if (o.isMeta || o.isVisibleInTranscriptOnly) return;
  const text = textOf((o.message || {}).content);
  if (!text.trim()) return; // tool_result 만 있는 사용자 레코드
  st.turns += 1;
  st.turnOver = false;
  if (!st.firstUser) st.firstUser = text.replace(/\s+/g, " ").slice(0, 120);
  st.lastUser = text.replace(/\s+/g, " ").slice(0, 300);
  recordUser(st, text, ts);
}

module.exports = { onAssistant, onUser };
