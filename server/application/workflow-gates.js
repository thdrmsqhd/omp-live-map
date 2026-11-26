"use strict";

const { gateForRole } = require("../engineering/harness-kinds");

const manualGateText = Object.freeze({
  browser: "브라우저의 결제·동의·비밀번호 화면은 그 창에서 직접 처리하세요. 관제에는 그 정보를 입력하지 마세요.",
  payment: "결제는 원래 결제 창에서 직접 확인하고 처리하세요. 관제에는 결제 정보를 입력하지 마세요.",
  consent: "약관 원문을 직접 읽고 원래 창에서 동의 여부를 선택하세요.",
  password: "비밀번호는 원래 로그인 창에서만 입력하세요. 관제의 입력란에 비밀번호를 쓰지 마세요.",
  system: "시스템 변경은 해당 설치·설정 화면에서 직접 확인하세요. 이 버튼은 관리자 권한을 부여하지 않습니다.",
  uac: "Windows UAC 프롬프트가 표시된 경우 해당 시스템 화면에서만 처리하세요. 이 승인으로 관리자 권한을 얻지 않습니다.",
});

// 질문 카드가 받는 방법과, 실행 중 거절하는 방법. input·editor 는 허용 표 밖에 둔다.
const workflowAskMethods = Object.freeze(["ask", "select", "confirm"]);
const rejectedAskMethods = Object.freeze(["input", "editor"]);

function instructionFor(gate) {
  return typeof gate === "string" ? manualGateText[gate] : undefined;
}

function acceptsWorkflowAsk(method) {
  return workflowAskMethods.includes(method);
}

function rejectsWorkflowAsk(method) {
  return rejectedAskMethods.includes(method);
}

// 역할 문자열을 게이트로 바꾼다. 이미 승인된 단계는 호출자가 gateCleared 로 걸러 낸다.
function manualHold(node, role) {
  if (!node || !["agent", "loop"].includes(node.type)) return null;
  const gate = gateForRole(role);
  if (!gate) return null;
  return { gate, text: manualGateText[gate] };
}

module.exports = {
  manualGateText, workflowAskMethods, rejectedAskMethods,
  instructionFor, acceptsWorkflowAsk, rejectsWorkflowAsk, manualHold,
};
