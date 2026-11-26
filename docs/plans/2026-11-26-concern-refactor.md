# 관심사별 리팩토링 계획

상태: 코드로 반영함. 질문 화면, 하네스 종류, 중단 규칙, 관찰 읽기, 화면 껍데기를 이 순서대로 나눴다.

## 목표

화면, 정의, 실행, 개입, 관찰을 서로 다른 모듈이 소유하게 나눈다. 지금은 `ui/index.html` 한 파일과 `server/engineering/routes.js`, `server/engineering/workflow-engine.js`가 여러 관심사를 같이 알고 있다. 저장 형식과 실행 의미는 이 계획의 마지막 단계 전까지 바꾸지 않는다.

하지 않는 일: Windows UAC나 브라우저 결제 창을 가로채는 일, Live Map 세션 엔진 재작성, Workflow JSON을 마이그레이션 없이 바꾸는 일.

## 현재 계층

| 관심사 | 상위 | 하위 | 지금 소유 파일 |
|---|---|---|---|
| 화면 | 세션 지도 | 카드, 스테이지, 세션 목록 | `ui/js/view/render-map.js`, `stage.js`, `monitor.js` |
| 화면 | Workflow 관제 | 캔버스, 실행 오버레이, 세션 스트립, 문서 패널 | `ui/js/studio.js`, `ui/js/view/unified-workflow.js`, `unified-sessions.js`, `unified-project-context.js` |
| 화면 | 설정 | 프로젝트, 런타임, Task | `ui/engineering.html`, `ui/js/engineering.js` |
| 정의 | 카탈로그 | 18종, 역할 접두어 | `server/engineering/harness-kinds.js`, `ui/js/studio-nodes.js` |
| 정의 | 그래프 | 노드, 간선, 핸드오프 | `server/engineering/graph-definition.js`, `workflow-catalog.js` |
| 실행 | 스케줄 | 준비, 건너뜀, 조인 | `server/engineering/graph-scheduler.js`, `workflow-engine.js` |
| 실행 | 어댑터 | OMP, Claude, 질문 | `server/engineering/adapters.js`, `docker/bridge.cjs` |
| 실행 | 격리 | 워크트리, 컨테이너 | `server/infrastructure/docker.js`, `worktree.js` |
| 개입 | 승인 | 일반 승인, 수동 중단 | `workflow-engine.js`, `workflow-runs.js`, `ui/js/view/workflow-map.js` |
| 개입 | 질문 | 카드, 질문함, 세션 스트립 | `server/ui-requests.js`, `ui/js/view/workflow-queue.js`, `unified-sessions.js`, `chat-ask.js` |
| 관찰 | 기록 | 실시간 출력, 수행 기록 | `server/engineering/workflow-live.js`, `ui/js/view/workflow-transcript.js` |
| 관찰 | 문서 | 목적, 진행, 결정 | `server/engineering/project-context.js` |
| 관찰 | 평가 | 봉인 루브릭, 점수 | `server/engineering/independent-evaluation.js` |

## 1. 질문 화면을 한곳으로

- [x] `askCardHTML`과 답 보내기를 `ui/js/view/chat-ask.js` 한 함수로 남긴다.
- [x] `workflow-queue.js`, `unified-sessions.js`, `unified-workflow.js`는 그 함수만 부른다. 질문 마크업을 다시 만들지 않는다.
- [x] 세션 질문과 Workflow 질문의 키 형식은 그대로 둔다. `workflow-ask:<uuid>`와 세션 키를 섞지 않는다.
- [x] 확인: 같은 질문을 카드와 질문함에서 동시에 그려도 답은 한 번만 전달된다.

## 2. 하네스 종류를 한 모듈로

- [x] `ui/js/workspace-catalog.js`의 6계열 18종을 서버도 읽는 공통 모듈로 옮긴다. 후보 위치는 `server/engineering/harness-kinds.js`이고, 화면은 그 파일을 그대로 불러 쓴다.
- [x] 역할 접두어 `평가 하네스 · ...`는 저장 호환을 위해 남긴다. 새 코드는 종류 id `evaluation`으로 판정하고, 접두어 파싱은 그 모듈 안에만 둔다.
- [x] `studio-nodes.js`의 `harnessTypeOf`와 서버의 브라우저·시스템 역할 판정이 같은 함수를 쓰게 한다.
- [x] 확인: 18종 id와 출력 스키마 id가 화면과 서버에서 같다. 기존 저장 정의를 다시 쓰지 않아도 열린다.

## 3. 중단 규칙을 실행기 밖으로

- [x] `workflow-engine.js`의 수동 중단 문장과 브라우저·시스템 역할 판정을 `server/engineering/workflow-gates.js`로 옮긴다.
- [x] 엔진은 `hold`와 `gateCleared`만 호출한다. 어떤 역할이 어떤 중단인지 엔진이 직접 알지 않게 한다.
- [x] `adapters.js`의 질문 허용 목록(`ask`, `select`, `confirm`)과 거절 목록(`input`, `editor`)도 이 모듈의 허용 표로 옮긴다.
- [x] 확인: `tests/harness-gate.test.js`, `tests/manual-gate.test.js`, `tests/workflow-ask.test.js`가 파일 이동 후에도 통과한다.

## 4. 관찰은 읽기만

- [x] 수행 기록, 프로젝트 문서, 독립 평가를 실행 상태 변경 함수에 연결하지 않는다. 이미 평가 저장은 실행 행을 바꾸지 않는다. 이 경계를 테스트로 고정한다.
- [x] `routes.js`의 관찰용 GET을 한 읽기 객체로 모으되, 주소와 응답 필드는 유지한다.
- [x] 핸드오프 내용 검증은 이 단계에 넣지 않는다. 이름과 결과 경로 일치는 `workflow-catalog.js`에 남긴다.
- [x] 확인: 평가 요청 전후의 `workflow_run` 행이 같다.

## 5. 화면 껍데기는 마지막에

- [x] 1~4가 끝난 뒤에만 `ui/index.html`의 세션 지도, Workflow 관제, 설정 영역을 파일로 나눈다.
- [x] 모드 이름 `map`, `design`, `overview`와 주소 쿼리는 유지한다.
- [x] 세션 지도 전체를 Workflow 캔버스 안으로 합치지 않는다. 같은 화면의 세션 스트립만 유지한다.
- [x] 확인: 기존 데스크톱 검증 `tests/verification/engineering-desktop.cjs`와 `tests/verification/unified-workflow-desktop.cjs`가 통과한다.

## 순서

1번부터 한다. 2번과 3번은 1번이 끝난 뒤 서로 다른 파일이므로 같이 할 수 있다. 5번은 1~4의 확인 항목이 통과한 뒤에만 시작한다.
