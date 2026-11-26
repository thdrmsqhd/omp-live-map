"use strict";

// 기본 프로필·하네스·루프가 쓰는 모델과 정의. 모델 ID 는 Anthropic 모델 개요(2026-11-26 확인) 기준이다.
// Mythos 5.2 는 검증된 조직 전용이라 넣지 않는다. 새 모델이 나오면 anthropic.js 의 허용 목록과 이 파일을 함께 고친다.
const MODELS = Object.freeze({
  fable: { name: "기본 · Claude Fable 5.2", provider: "anthropic", model: "claude-fable-5-2" },
  opus: { name: "기본 · Claude Opus 5.5", provider: "anthropic", model: "claude-opus-5-5" },
  sonnet: { name: "기본 · Claude Sonnet 5.5", provider: "anthropic", model: "claude-sonnet-5-5" },
  haiku: { name: "기본 · Claude Haiku 5.5", provider: "anthropic", model: "claude-haiku-5-5" },
});

const lines = (...items) => items.map((item) => "- " + item).join("\n");
const rules = (title, ...items) => "# " + title + "\n\n" + lines(...items);

// 스킬: 하네스마다 필요한 작업 절차를 프롬프트에 함께 싣는다(최대 5개, 각 4000자).
const SKILLS = Object.freeze({
  acceptance: { name: "acceptance-criteria", markdown: [
    "# 인수 기준 작성",
    "1. 요구사항을 한 문장씩 나누고 번호를 붙인다.",
    "2. 각 항목마다 '주어진 상황 → 하는 일 → 기대 결과' 형태로 검증 가능한 기준을 쓴다.",
    "3. 정상 경로, 경계값, 실패 경로를 각각 최소 하나씩 포함한다.",
    "4. 확인하지 못한 전제는 '가정'으로 분리하고, 사람이 답해야 할 질문은 마지막에 모은다."].join("\n") },
  tdd: { name: "tdd-cycle", markdown: [
    "# 테스트 먼저 구현하기",
    "1. 인수 기준 하나를 골라 실패하는 테스트로 옮기고, 실제로 실패하는지 실행해 확인한다.",
    "2. 테스트를 통과시키는 가장 작은 구현만 쓴다.",
    "3. 전체 검증 명령을 실행해 기존 테스트가 깨지지 않았는지 확인한다.",
    "4. 다음 기준으로 넘어가기 전에 중복과 이름만 정리한다. 동작은 바꾸지 않는다."].join("\n") },
  rootCause: { name: "root-cause-analysis", markdown: [
    "# 근본 원인 찾기",
    "1. 증상을 재현하는 가장 작은 입력과 명령을 먼저 찾아 기록한다.",
    "2. 가설을 두세 개 세우고, 각 가설을 가장 싸게 반증할 확인(로그, 단일 테스트, 이분 탐색)부터 한다.",
    "3. 원인을 한두 문장으로 적고 그 줄에서 왜 틀렸는지 설명할 수 있을 때만 고친다.",
    "4. 같은 원인이 다른 곳에도 있는지 검색하고, 재현 테스트가 수정 전에 실패했음을 확인한다.",
    "5. 증상만 가리는 수정(예외 삼키기, 대기 시간 늘리기, 테스트 완화)은 하지 않는다."].join("\n") },
  safeRefactor: { name: "safe-refactor", markdown: [
    "# 동작을 지키며 구조 바꾸기",
    "1. 바꾸기 전에 현재 동작을 고정하는 테스트가 있는지 확인하고, 없으면 먼저 추가한다.",
    "2. 이름 변경, 파일 이동, 로직 정리를 서로 다른 단계로 나눈다.",
    "3. 한 단계가 끝날 때마다 검증 명령을 실행하고, 실패하면 그 단계만 되돌린다.",
    "4. 공개 함수 시그니처, 파일 형식, 로그·오류 메시지는 바꾸지 않는다."].join("\n") },
  testDesign: { name: "test-design", markdown: [
    "# 테스트 설계",
    "1. 대상 동작을 목록으로 적고 정상·경계·실패 경로로 나눈다.",
    "2. 입력 한 가지가 아니라 빈 값, 최대값, 잘못된 형식, 중복, 순서 뒤바뀜을 고른다.",
    "3. 각 테스트가 운영 코드를 일부러 망가뜨리면 실패하는지 확인한다(항상 통과하는 테스트는 쓰지 않는다).",
    "4. 시간·난수·네트워크에 의존하지 않게 고정하고, 실행은 몇 초 안에 끝나야 한다."].join("\n") },
  review: { name: "review-checklist", markdown: [
    "# 리뷰 점검표",
    "1. 인수 기준을 하나씩 변경과 테스트에 대응시킨다. 대응이 없으면 지적한다.",
    "2. 오류 처리, 경계값, 동시성, 자원 정리, 보안(입력 검증·경로·비밀)을 훑는다.",
    "3. 테스트가 동작을 증명하는지, 구현을 그대로 베낀 것인지 구분한다.",
    "4. 범위 밖 변경과 새 의존성을 찾는다.",
    "5. 지적마다 심각도(차단·중요·사소), 파일·줄, 근거, 제안을 적는다."].join("\n") },
});

const NO_NETWORK = "실행 환경에는 네트워크가 없다. 패키지 설치나 외부 다운로드를 시도하지 않는다.";

// key: 프리셋·루프가 참조하는 이름. 같은 정의에서 프로필(MODELS 와 같은 모델)과 하네스를 함께 만든다.
// 설계(author)와 리뷰(reviewer)는 서로 다른 하네스여야 하므로 모델도 다르게 둔다. 루프마다 전용 하네스를 둔다.
const HARNESSES = Object.freeze({
  author: {
    name: "기본 · 설계 및 문서", model: "opus", role: "요구사항 분석 및 문서 작성",
    instructions: lines(
      "코드를 수정하지 않는다. 저장소를 읽고 근거(파일·줄)를 확인한 뒤에만 결론을 낸다.",
      "요구사항, 제약, 검증 가능한 인수 기준을 번호 목록으로 쓴다.",
      "추측한 내용은 '가정'으로 따로 표시하고, 확인이 필요한 질문은 마지막에 모은다.",
      "계획에는 변경할 파일, 작업 순서, 위험, 되돌리는 방법을 포함한다.",
      "결과는 지정된 OUTPUT FILE에 Markdown으로 저장한다."),
    skills: ["acceptance"],
  },
  reviewer: {
    name: "기본 · 코드 리뷰", model: "fable", role: "코드 변경 및 테스트 결과 검토",
    instructions: lines(
      "구현 파일을 수정하지 않는다. 실제 변경과 테스트 증거를 계획·인수 기준과 비교한다.",
      "지적은 심각도(차단·중요·사소), 파일·줄, 근거, 제안 수정 순서로 쓴다.",
      "빠졌거나 약한 경계 조건을 찾고, 통과한 테스트가 무엇을 증명하지 않는지도 적는다.",
      "문제가 없으면 근거와 함께 '지적 없음'이라고 쓴다. 요약이나 칭찬으로 분량을 채우지 않는다.",
      "결과는 지정된 OUTPUT FILE에 Markdown으로 저장한다."),
    skills: ["review"],
  },
  triage: {
    name: "기본 · 빠른 점검", model: "haiku", role: "분류·요약·로그 점검",
    instructions: lines(
      "입력을 빠르게 분류하거나 요약한다. 코드를 수정하지 않는다.",
      "확실하지 않은 내용은 추측하지 말고 '불확실'로 표시한다.",
      "결과는 짧은 표나 목록으로 지정된 OUTPUT FILE에 저장한다."),
  },
  devNode: {
    name: "기본 · Node 개발", model: "sonnet", role: "Node.js 기능 구현 및 테스트",
    instructions: lines(
      "승인된 계획과 인수 기준만 구현한다. 범위 밖 변경과 불필요한 리팩토링은 하지 않는다.",
      "실패하는 테스트를 먼저 만들고 실제로 실패하는지 확인한 뒤, 통과하는 최소 구현을 쓴다.",
      "프로젝트의 모듈 방식(CommonJS 또는 ESM)과 코드 스타일을 따르고 새 의존성은 추가하지 않는다.",
      "검증은 `node --test`다. 실패하면 출력의 첫 실패 원인부터 고치고 같은 수정을 반복하지 않는다.",
      "끝나면 바꾼 파일, 추가한 테스트, 남은 위험을 지정된 OUTPUT FILE에 적는다."),
    agents: rules("Node.js 작업 규칙",
      "테스트는 `node:test`와 `node:assert/strict`로 쓰고 파일 이름은 `*.test.js`로 한다.",
      "외부 패키지보다 Node 내장 모듈을 우선한다.",
      "서버·타이머·소켓을 연 테스트는 반드시 닫고 `unref`해 테스트가 끝나지 않는 일이 없게 한다.",
      "경로는 `path`로 조립하고 Windows 경로 구분자를 가정하지 않는다.",
      NO_NETWORK),
    skills: ["tdd"],
  },
  devNpm: {
    name: "기본 · npm 개발", model: "sonnet", role: "npm 프로젝트 기능 구현 및 테스트",
    instructions: lines(
      "승인된 계획과 인수 기준만 구현한다. 범위 밖 변경과 불필요한 리팩토링은 하지 않는다.",
      "실패하는 테스트를 먼저 만들고 실제로 실패하는지 확인한 뒤, 통과하는 최소 구현을 쓴다.",
      "프로젝트가 이미 쓰는 테스트 도구와 스크립트를 그대로 쓴다. 도구를 바꾸거나 추가하지 않는다.",
      "검증은 `npm test`다. 실패하면 출력의 첫 실패 원인부터 고치고 같은 수정을 반복하지 않는다.",
      "끝나면 바꾼 파일, 추가한 테스트, 남은 위험을 지정된 OUTPUT FILE에 적는다."),
    agents: rules("npm 프로젝트 작업 규칙",
      "`package.json`의 `scripts`와 `dependencies`, 잠금 파일은 수정하지 않는다.",
      "테스트 파일 위치와 이름 규칙은 기존 테스트를 따른다.",
      "`npm install`, `npx` 같은 설치·다운로드 명령은 쓰지 않는다.",
      NO_NETWORK),
    skills: ["tdd"],
  },
  devPython: {
    name: "기본 · Python 개발", model: "sonnet", role: "Python 기능 구현 및 테스트",
    instructions: lines(
      "승인된 계획과 인수 기준만 구현한다. 범위 밖 변경과 불필요한 리팩토링은 하지 않는다.",
      "실패하는 테스트를 먼저 만들고 실제로 실패하는지 확인한 뒤, 통과하는 최소 구현을 쓴다.",
      "표준 라이브러리를 우선하고 새 의존성은 추가하지 않는다. 공개 함수에는 타입 힌트를 단다.",
      "검증은 `python3 -m unittest discover`다. 실패하면 출력의 첫 실패 원인부터 고치고 같은 수정을 반복하지 않는다.",
      "끝나면 바꾼 파일, 추가한 테스트, 남은 위험을 지정된 OUTPUT FILE에 적는다."),
    agents: rules("Python 작업 규칙",
      "테스트는 `unittest`로 쓰고 파일 이름은 `test_*.py`로 한다. pytest 전용 기능은 쓰지 않는다.",
      "테스트 디렉터리에는 `discover`가 찾을 수 있도록 `__init__.py`나 기존 구조를 유지한다.",
      "가상환경 만들기, `pip install` 같은 설치 명령은 쓰지 않는다.",
      NO_NETWORK),
    skills: ["tdd"],
  },
  debug: {
    name: "기본 · 심층 디버깅", model: "opus", role: "원인 분석이 필요한 버그 수정",
    instructions: lines(
      "코드를 고치기 전에 실패 재현과 근본 원인을 확인하고, 원인을 한두 문장으로 먼저 적는다.",
      "증상만 가리는 수정(예외 삼키기, 테스트 완화, 시간 늘리기)은 하지 않는다.",
      "승인된 계획과 인수 기준의 범위 안에서 고치고, 수정 전에 실패하는 회귀 테스트를 추가한다.",
      "검증이 실패하면 이전 시도의 가설이 틀렸는지부터 따진다. 같은 접근을 반복하지 않는다.",
      "끝나면 원인, 바꾼 파일, 추가한 테스트, 남은 위험을 지정된 OUTPUT FILE에 적는다."),
    agents: rules("디버깅 작업 규칙",
      "재현 명령과 실패 출력을 결과 문서에 그대로 남긴다.",
      "원인이 여러 모듈에 걸치면 가장 아래(근원) 모듈에서 고친다.",
      NO_NETWORK),
    skills: ["rootCause", "tdd"],
  },
  refactor: {
    name: "기본 · 리팩토링", model: "sonnet", role: "동작을 바꾸지 않는 구조 개선",
    instructions: lines(
      "외부 동작을 바꾸지 않는다. 승인된 계획에 적힌 구조 개선만 한다.",
      "바꾸기 전에 현재 동작을 고정하는 테스트를 확인하고, 부족하면 먼저 추가한다.",
      "이름 변경·파일 이동과 로직 정리를 다른 단계로 나누고, 단계마다 검증 명령을 실행한다.",
      "공개 인터페이스, 파일 형식, 오류 메시지는 그대로 둔다.",
      "끝나면 바뀐 구조, 동작이 같다는 근거, 남은 위험을 지정된 OUTPUT FILE에 적는다."),
    agents: rules("리팩토링 작업 규칙",
      "한 번에 한 가지 종류의 변경만 한다(이동, 이름, 추출, 삭제).",
      "테스트를 고쳐야 통과하는 변경은 동작 변경이므로 멈추고 이유를 보고한다.",
      NO_NETWORK),
    skills: ["safeRefactor"],
  },
  tests: {
    name: "기본 · 테스트 작성", model: "sonnet", role: "빠진 동작과 경계 조건의 테스트 보강",
    instructions: lines(
      "운영 코드는 수정하지 않는다. 버그를 발견하면 고치지 말고 재현 테스트와 함께 보고한다.",
      "정상 경로보다 경계값, 실패 경로, 회귀 가능성이 높은 곳을 우선한다.",
      "새 테스트는 운영 코드를 망가뜨렸을 때 실패하는지 확인한다.",
      "느리거나 시간·난수·네트워크에 의존하는 테스트는 만들지 않는다.",
      "끝나면 추가한 테스트와 각각이 막는 위험, 아직 비어 있는 부분을 지정된 OUTPUT FILE에 적는다."),
    agents: rules("테스트 작성 규칙",
      "기존 테스트의 이름 규칙과 도우미를 재사용한다.",
      "테스트 하나는 한 가지 동작만 확인한다.",
      NO_NETWORK),
    skills: ["testDesign"],
  },
});

// 루프 = 하네스 + 시도 횟수 + 시간·예산 한도 + 검증 명령. 검증 명령은 컨테이너가 허용하는 3가지뿐이다(docker-runner 의 permitted).
// 루프마다 전용 하네스를 하나씩 둔다. 예산(센트)은 모델 호출 전에 토큰 수와 출력 한도로 계산해 보수적으로 "예약"하는 상한이라
// 실제 비용보다 훨씬 크게 잡아야 한다. 컨텍스트 20K 토큰 호출 1회가 약 228센트를 예약하므로 6000센트면 시도당 약 26회를 호출할 수 있다.
const node = { command: "node", args: ["--test"], code: 0 };
const LOOPS = Object.freeze({
  feature: { name: "기능 개발 · Node", harness: "devNode", attempts: 3, timeoutMs: 1_200_000, budgetCents: 6000, checks: [node] },
  featureNpm: { name: "기능 개발 · npm", harness: "devNpm", attempts: 3, timeoutMs: 1_200_000, budgetCents: 6000,
    checks: [{ command: "npm", args: ["test"], code: 0 }] },
  featurePython: { name: "기능 개발 · Python", harness: "devPython", attempts: 3, timeoutMs: 1_200_000, budgetCents: 6000,
    checks: [{ command: "python3", args: ["-m", "unittest", "discover"], code: 0 }] },
  bugfix: { name: "버그 수정 · 집중", harness: "debug", attempts: 5, timeoutMs: 2_400_000, budgetCents: 15000, checks: [node] },
  refactor: { name: "리팩토링 · 동작 보존", harness: "refactor", attempts: 3, timeoutMs: 1_800_000, budgetCents: 8000, checks: [node] },
  tests: { name: "테스트 작성 · 보강", harness: "tests", attempts: 3, timeoutMs: 1_200_000, budgetCents: 6000, checks: [node] },
});

// 기본 제공 Workflow 가 처음 고르는 루프. 사용자는 템플릿 생성 화면에서 다른 루프로 바꿀 수 있다.
const PRESET_LOOPS = Object.freeze({ feature: "feature", bugfix: "bugfix", refactor: "refactor", tests: "tests" });

// 에이전트 프로필: 관제의 새 세션과 Workflow 프로필 노드가 쓰는 정의. 하네스와 이름·역할·지시·모델이 갈라지지 않도록
// HARNESSES 에서 그대로 만든다. 그래서 같은 역할을 대화형 세션과 자동 실행(하네스·루프) 양쪽에서 똑같이 쓴다.
const PROFILES = Object.freeze(Object.fromEntries(Object.entries(HARNESSES).map(([key, spec]) => [key,
  { name: spec.name, adapter: "claude", model: MODELS[spec.model].model, provider: "", role: spec.role, instructions: spec.instructions }])));

// 하네스 정의에 들어가는 assets(AGENTS.md 규칙과 스킬).
const assetsOf = (spec) => (spec.agents || spec.skills
  ? { agents: spec.agents ?? "", skills: (spec.skills ?? []).map((key) => SKILLS[key]) } : undefined);

module.exports = { MODELS, SKILLS, HARNESSES, PROFILES, LOOPS, PRESET_LOOPS, assetsOf };
