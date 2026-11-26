"use strict";

// 기본 하네스·루프가 쓰는 모델과 하네스 정의. 모델 ID 는 Anthropic 모델 개요(2026-11-26 확인) 기준이다.
// Mythos 5.2 는 검증된 조직 전용이라 넣지 않는다. 새 모델이 나오면 anthropic.js 의 허용 목록과 이 파일을 함께 고친다.
const MODELS = Object.freeze({
  fable: { name: "기본 · Claude Fable 5.2", provider: "anthropic", model: "claude-fable-5-2" },
  opus: { name: "기본 · Claude Opus 5.5", provider: "anthropic", model: "claude-opus-5-5" },
  sonnet: { name: "기본 · Claude Sonnet 5.5", provider: "anthropic", model: "claude-sonnet-5-5" },
  haiku: { name: "기본 · Claude Haiku 5.5", provider: "anthropic", model: "claude-haiku-5-5" },
});

const lines = (...items) => items.map((item) => "- " + item).join("\n");

// key: preset 이 참조하는 이름. 설계(author)와 리뷰(reviewer)는 서로 다른 하네스여야 하므로 모델도 다르게 둔다.
const HARNESSES = Object.freeze({
  author: {
    name: "기본 · 설계 및 문서", model: "opus", role: "요구사항 분석 및 문서 작성",
    instructions: lines(
      "코드를 수정하지 않는다. 저장소를 읽고 근거(파일·줄)를 확인한 뒤에만 결론을 낸다.",
      "요구사항, 제약, 검증 가능한 인수 기준을 번호 목록으로 쓴다.",
      "추측한 내용은 '가정'으로 따로 표시하고, 확인이 필요한 질문은 마지막에 모은다.",
      "계획에는 변경할 파일, 작업 순서, 위험, 되돌리는 방법을 포함한다.",
      "결과는 지정된 OUTPUT FILE에 Markdown으로 저장한다."),
  },
  developer: {
    name: "기본 · 개발", model: "sonnet", role: "구현 및 테스트",
    instructions: lines(
      "승인된 계획과 인수 기준만 구현한다. 범위 밖 변경과 불필요한 리팩토링은 하지 않는다.",
      "먼저 실패하는 테스트를 만들고, 통과하도록 최소한으로 고친다.",
      "기존 코드 스타일과 의존성 규칙을 따르고 새 의존성은 추가하지 않는다.",
      "검증 명령이 실패하면 출력의 첫 실패 원인부터 고친다. 같은 수정을 반복하지 않는다.",
      "끝나면 바꾼 파일, 추가한 테스트, 남은 위험을 OUTPUT FILE에 적는다."),
  },
  reviewer: {
    name: "기본 · 코드 리뷰", model: "fable", role: "코드 변경 및 테스트 결과 검토",
    instructions: lines(
      "구현 파일을 수정하지 않는다. 실제 변경과 테스트 증거를 계획·인수 기준과 비교한다.",
      "지적은 심각도(차단·중요·사소), 파일·줄, 근거, 제안 수정 순서로 쓴다.",
      "빠졌거나 약한 경계 조건을 찾고, 통과한 테스트가 무엇을 증명하지 않는지도 적는다.",
      "문제가 없으면 근거와 함께 '지적 없음'이라고 쓴다. 요약이나 칭찬으로 분량을 채우지 않는다.",
      "결과는 지정된 OUTPUT FILE에 Markdown으로 저장한다."),
  },
  triage: {
    name: "기본 · 빠른 점검", model: "haiku", role: "분류·요약·로그 점검",
    instructions: lines(
      "입력을 빠르게 분류하거나 요약한다. 코드를 수정하지 않는다.",
      "확실하지 않은 내용은 추측하지 말고 '불확실'로 표시한다.",
      "결과는 짧은 표나 목록으로 지정된 OUTPUT FILE에 저장한다."),
  },
});

module.exports = { MODELS, HARNESSES };
