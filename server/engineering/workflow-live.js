"use strict";

// 실행 중인 Workflow 단계의 진행 상황(단계, 시도, 프롬프트 구성, 최근 출력, 도구)을 메모리에만 둔다.
// 관제 화면이 "지금 이 단계에서 프롬프트가 실행 중"임을 보여 주는 용도다. 완료된 결과는 workflow_node 에 저장된다.
const { maskSecrets } = require("./state");

const TEXT_LIMIT = 1600;
const TOOL_LIMIT = 6;
const runs = new Map();

function entry(run, node) {
  let nodes = runs.get(run);
  if (!nodes) runs.set(run, nodes = new Map());
  let state = nodes.get(node);
  if (!state) nodes.set(node, state = { phase: "preparing", startedAt: Date.now(), updated: Date.now(), attempt: 0, attempts: 1,
    text: "", tool: "", tools: [], sections: [], chars: 0 });
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
  if (Number.isSafeInteger(patch.attempt)) state.attempt = patch.attempt;
  if (Number.isSafeInteger(patch.attempts)) state.attempts = patch.attempts;
  if (Array.isArray(patch.sections)) {
    state.sections = patch.sections.slice(0, 20).map(({ name, chars }) => ({ name: String(name).slice(0, 40), chars: Number(chars) || 0 }));
    state.chars = state.sections.reduce((sum, { chars }) => sum + chars, 0);
  }
  if (patch.reset) state.text = "";
  if (typeof patch.text === "string" && patch.text) state.text = (state.text + patch.text).slice(-TEXT_LIMIT);
  if (typeof patch.tool === "string" && patch.tool) {
    state.tool = patch.tool.slice(0, 120);
    state.tools = [...state.tools.filter((name) => name !== state.tool), state.tool].slice(-TOOL_LIMIT);
  }
  state.updated = Date.now();
}

function end(run, node) {
  const nodes = runs.get(run);
  if (!nodes) return;
  nodes.delete(node);
  if (!nodes.size) runs.delete(run);
}

function snapshot(run) {
  const nodes = runs.get(run);
  if (!nodes) return {};
  return Object.fromEntries([...nodes].map(([node, state]) => [node, { ...state, tools: [...state.tools],
    sections: state.sections.map((section) => ({ ...section })), text: maskSecrets(state.text) }]));
}

// 어댑터가 넘기는 콜백. 진행 표시 실패가 실행을 멈추지 않게 한다.
function reporter(run, node) {
  return (patch) => {
    try { update(run, node, patch); } catch { /* 진행 표시는 실행 결과에 영향을 주지 않는다 */ }
  };
}

module.exports = { start, update, end, snapshot, reporter };
