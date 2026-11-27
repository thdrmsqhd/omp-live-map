"use strict";

// 실행기(adapter) 목록은 여기 한 곳에 적는다.
// 하네스 정의 검증, 대화형 세션의 하네스 적용, 실행기 조립이 모두 이 표를 읽는다.
// 새 실행기를 넣을 때는 이 표에 항목을 하나 더하고 adapters.js 의 runners 에 실행 함수를 하나 더한다.
const adapterSpecs = Object.freeze({
  omp: Object.freeze({
    id: "omp",
    label: "omp",
    reasoning: true,
    // 모델 정의에 적힌 공급자를 그대로 쓴다.
    provider: (model) => model.provider || "",
  }),
  claude: Object.freeze({
    id: "claude",
    label: "Claude Code",
    reasoning: false,
    provider: () => "anthropic",
  }),
});

const adapterIds = Object.freeze(Object.keys(adapterSpecs));

function isAdapter(id) {
  return typeof id === "string" && Object.hasOwn(adapterSpecs, id);
}

function adapterSpec(id) {
  return isAdapter(id) ? adapterSpecs[id] : null;
}

module.exports = { adapterSpecs, adapterIds, isAdapter, adapterSpec };
