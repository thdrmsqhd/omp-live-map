"use strict";

// 세션 프로필(맵 세션·Workflow Agent 가 쓰는 역할·지시·실행기·모델) 페이로드 검증.
// 이전 저장소(session-harness.sqlite)와 정의 저장소(definition kind='profile')가 같은 규칙을 쓴다.
const { isAdapter } = require("./adapter-registry");

function field(value, limit, label) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > limit || value.includes("\0")) {
    throw new Error(label + " 형식을 확인해 주세요.");
  }
  return value.trim();
}

function profilePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("프로필 내용을 입력해 주세요.");
  const name = field(input.name, 120, "이름");
  const role = field(input.role, 240, "역할");
  const instructions = field(input.instructions, 12000, "작업 지시");
  const adapter = input.adapter;
  const model = field(input.model, 160, "모델");
  const provider = adapter === "omp" && model ? field(input.provider, 80, "모델 제공자") : "";
  if (!name || !isAdapter(adapter)) throw new Error("이름과 실행기를 입력해 주세요.");
  if (adapter === "omp" && model && !provider) throw new Error("OMP 모델을 지정하려면 모델 제공자도 입력해 주세요.");
  if (adapter === "claude" && model && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(model)) {
    throw new Error("Claude 모델 ID 형식을 확인해 주세요.");
  }
  return { name, role, instructions, adapter, model, provider };
}

module.exports = { profilePayload, field };
