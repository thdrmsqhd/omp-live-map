"use strict";

// 실행 중인 Workflow 단계의 진행 상황(단계, 시도, 프롬프트 구성, 최근 출력, 도구)을 메모리에 두고,
// 단계가 끝나면 그 단계의 전체 수행 기록(출력·도구 호출·시도 구분)을 파일로 남긴다(configure 로 폴더를 정했을 때).
// 관제 화면은 실행 중에는 snapshot(최근 출력), 실행 중·후 모두 transcript(전체 기록)로 작업 지시의 수행 내역을 보여 준다.
const fs = require("node:fs");
const path = require("node:path");
const { maskSecrets } = require("./state");

const TEXT_LIMIT = 4000;          // 노드 카드·상세 패널에 흘리는 최근 출력
const TOOL_LIMIT = 6;
const TRANSCRIPT_LIMIT = 200 * 1024; // 단계 한 번 실행의 전체 기록 상한(앞 24KB + 뒤쪽, 가운데는 줄인다)
const TRANSCRIPT_HEAD = 24 * 1024;
const TRANSCRIPT_TOOLS = 200;
const KEEP_RUNS = 300;            // 기록을 남기는 최근 실행 수
const runs = new Map();
let journal = null;

function configure({ directory } = {}) {
  journal = directory ? path.join(directory, "workflow-transcripts") : null;
  if (!journal) return;
  try {
    fs.mkdirSync(journal, { recursive: true, mode: 0o700 });
    const dirs = fs.readdirSync(journal, { withFileTypes: true }).filter((item) => item.isDirectory())
      .map(({ name }) => ({ name, at: fs.statSync(path.join(journal, name)).mtimeMs })).sort((a, b) => b.at - a.at);
    for (const { name } of dirs.slice(KEEP_RUNS)) fs.rmSync(path.join(journal, name), { recursive: true, force: true });
  } catch { /* 기록 폴더를 못 만들면 실행 중 기록만 보여 준다 */ }
}

// 전체 기록에 글자를 붙인다. 상한을 넘으면 앞부분(작업을 시작한 맥락)과 최근 부분을 남기고 가운데를 버린다.
function appendLog(log, text) {
  if (log.head.length < TRANSCRIPT_HEAD) {
    const take = text.slice(0, TRANSCRIPT_HEAD - log.head.length);
    log.head += take;
    text = text.slice(take.length);
  }
  if (!text) return;
  log.tail += text;
  const max = TRANSCRIPT_LIMIT - TRANSCRIPT_HEAD;
  if (log.tail.length > max) {
    log.dropped += log.tail.length - max;
    log.tail = log.tail.slice(-max);
  }
}

function entry(run, node) {
  let nodes = runs.get(run);
  if (!nodes) runs.set(run, nodes = new Map());
  let state = nodes.get(node);
  if (!state) nodes.set(node, state = { phase: "preparing", startedAt: Date.now(), updated: Date.now(), attempt: 0, attempts: 1,
    text: "", tool: "", tools: [], sections: [], chars: 0, log: { head: "", tail: "", dropped: 0, tools: [] } });
  return state;
}

function start(run, node, { attempts = 1 } = {}) {
  runs.get(run)?.delete(node);
  const state = entry(run, node);
  state.attempts = attempts;
  return state;
}

// patch: { phase, attempt, attempts, sections, text(추가할 조각), tool(새로 쓰기 시작한 도구) }
function update(run, node, patch = {}) {
  const state = entry(run, node);
  if (typeof patch.phase === "string") state.phase = patch.phase.slice(0, 40);
  if (Number.isSafeInteger(patch.attempt) && patch.attempt !== state.attempt) {
    if (state.attempt || patch.attempt > 1) appendLog(state.log, "\n\n── 시도 " + patch.attempt + (state.attempts > 1 ? "/" + state.attempts : "") + " ──\n");
    state.attempt = patch.attempt;
  }
  if (Number.isSafeInteger(patch.attempts)) state.attempts = patch.attempts;
  if (Array.isArray(patch.sections)) {
    state.sections = patch.sections.slice(0, 20).map(({ name, chars }) => ({ name: String(name).slice(0, 40), chars: Number(chars) || 0 }));
    state.chars = state.sections.reduce((sum, { chars }) => sum + chars, 0);
  }
  if (patch.reset) state.text = "";
  if (typeof patch.text === "string" && patch.text) {
    state.text = (state.text + patch.text).slice(-TEXT_LIMIT);
    appendLog(state.log, patch.text);
  }
  if (typeof patch.tool === "string" && patch.tool) {
    state.tool = patch.tool.slice(0, 120);
    if (state.log.tools.length < TRANSCRIPT_TOOLS) state.log.tools.push({ at: Date.now() - state.startedAt, name: state.tool });
    state.tools = [...state.tools.filter((name) => name !== state.tool), state.tool].slice(-TOOL_LIMIT);
  }
  state.updated = Date.now();
}

const fileOf = (run, node, startedAt) => path.join(journal, encodeURIComponent(run), encodeURIComponent(node) + "." + startedAt + ".json");
const valid = (run, node) => typeof run === "string" && typeof node === "string" && run.length <= 200 && node.length <= 200 && run && node;

// 한 번의 단계 실행 기록(화면·파일 공통 형식). 비밀 값은 가린다.
function record(node, state, endedAt = null) {
  return { node, startedAt: state.startedAt, endedAt, attempts: state.attempts, attempt: state.attempt,
    tools: state.log.tools.map((item) => ({ ...item })), dropped: state.log.dropped,
    text: maskSecrets(state.log.head + (state.log.dropped ? "\n\n…(가운데 " + state.log.dropped.toLocaleString("ko-KR") + "자 생략)…\n\n" : "") + state.log.tail) };
}

function end(run, node) {
  const nodes = runs.get(run);
  if (!nodes) return;
  const state = nodes.get(node);
  if (state && journal && valid(run, node) && (state.log.head || state.log.tools.length)) {
    try {
      fs.mkdirSync(path.join(journal, encodeURIComponent(run)), { recursive: true, mode: 0o700 });
      fs.writeFileSync(fileOf(run, node, state.startedAt), JSON.stringify(record(node, state, Date.now())), { mode: 0o600 });
    } catch { /* 기록을 못 남겨도 실행 결과에는 영향이 없다 */ }
  }
  nodes.delete(node);
  if (!nodes.size) runs.delete(run);
}

function snapshot(run) {
  const nodes = runs.get(run);
  if (!nodes) return {};
  return Object.fromEntries([...nodes].map(([node, { log, ...state }]) => [node, { ...state, tools: [...state.tools],
    sections: state.sections.map((section) => ({ ...section })), text: maskSecrets(state.text) }]));
}

// 단계의 전체 수행 기록. 실행 중이면 지금 기록을 맨 앞에, 끝난 실행(재시도 포함)은 최근 것부터 붙인다.
function transcript(run, node) {
  if (!valid(run, node)) return { running: false, entries: [] };
  const current = runs.get(run)?.get(node);
  const entries = current ? [record(node, current)] : [];
  if (journal) {
    try {
      const prefix = encodeURIComponent(node) + ".";
      const files = fs.readdirSync(path.join(journal, encodeURIComponent(run))).filter((name) => name.startsWith(prefix) && /^\d+\.json$/.test(name.slice(prefix.length)))
        .sort((a, b) => Number(b.slice(prefix.length, -5)) - Number(a.slice(prefix.length, -5)));
      for (const name of files.slice(0, 10)) {
        try { entries.push(JSON.parse(fs.readFileSync(path.join(journal, encodeURIComponent(run), name), "utf8"))); } catch { /* 깨진 기록은 건너뛴다 */ }
      }
    } catch { /* 아직 끝난 실행이 없다 */ }
  }
  return { running: Boolean(current), entries };
}

// 어댑터가 넘기는 콜백. 진행 표시 실패가 실행을 멈추지 않게 한다.
function reporter(run, node) {
  return (patch) => {
    try { update(run, node, patch); } catch { /* 진행 표시는 실행 결과에 영향을 주지 않는다 */ }
  };
}

module.exports = { configure, start, update, end, snapshot, transcript, reporter };
