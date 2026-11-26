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
  deep: {
    name: "기본 · 심층 개발", model: "opus", role: "원인 분석이 필요한 구현 및 테스트",
    instructions: lines(
      "코드를 고치기 전에 실패 재현과 근본 원인을 확인하고, 원인을 한두 문장으로 먼저 적는다.",
      "증상만 가리는 수정(예외 삼키기, 테스트 완화, 시간 늘리기)은 하지 않는다.",
      "승인된 계획과 인수 기준의 범위 안에서 구현하고, 회귀를 막는 테스트를 추가한다.",
      "검증이 실패하면 이전 시도의 가설이 틀렸는지부터 따진다. 같은 접근을 반복하지 않는다.",
      "끝나면 원인, 바꾼 파일, 추가한 테스트, 남은 위험을 지정된 OUTPUT FILE에 적는다."),
  },
  triage: {
    name: "기본 · 빠른 점검", model: "haiku", role: "분류·요약·로그 점검",
    instructions: lines(
      "입력을 빠르게 분류하거나 요약한다. 코드를 수정하지 않는다.",
      "확실하지 않은 내용은 추측하지 말고 '불확실'로 표시한다.",
      "결과는 짧은 표나 목록으로 지정된 OUTPUT FILE에 저장한다."),
  },
});

// 루프 = 하네스 + 시도 횟수 + 시간·예산 한도 + 검증 명령. 검증 명령은 컨테이너가 허용하는 3가지뿐이다(docker-runner 의 permitted).
// 예산(센트)은 모델 호출 전에 토큰 수와 출력 한도로 계산해 보수적으로 "예약"하는 상한이라 실제 비용보다 훨씬 크게 잡아야 한다.
// 컨텍스트 20K 토큰 호출 1회가 약 228센트를 예약하므로 6000센트면 시도당 약 26회, 15000센트면 약 65회를 호출할 수 있다.
const standard = { attempts: 3, timeoutMs: 1_200_000, budgetCents: 6000 };
const LOOPS = Object.freeze({
  node: { name: "기본 · 개발 및 테스트", harness: "developer", ...standard, checks: [{ command: "node", args: ["--test"], code: 0 }] },
  npm: { name: "기본 · 개발 및 테스트 (npm)", harness: "developer", ...standard, checks: [{ command: "npm", args: ["test"], code: 0 }] },
  python: { name: "기본 · 개발 및 테스트 (Python)", harness: "developer", ...standard,
    checks: [{ command: "python3", args: ["-m", "unittest", "discover"], code: 0 }] },
  deep: { name: "집중 · 어려운 버그 수정", harness: "deep", attempts: 5, timeoutMs: 2_400_000, budgetCents: 15000,
    checks: [{ command: "node", args: ["--test"], code: 0 }] },
});

module.exports = { MODELS, HARNESSES, LOOPS };
