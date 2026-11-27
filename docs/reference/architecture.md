# 구조와 설계 규칙

```
server.js              진입점: 주기 스캔, fs.watch, listen
server/
  config.js            경로·포트·상수
  tail.js ingest.js turns.js     기록 수집: 증분 읽기 → 이벤트 반영 → 대화·시간당 토큰
  snapshot.js models.js          세션/노드 그래프, 컨텍스트 상한 조회, 요약 호출
  proc.js owner.js sys.js infra.js   프로세스·세션 소유 프로세스·호스트·WSL/Docker 관측
  shell.js prompt.js             Git Bash 실행, 백그라운드 잡, omp 프롬프트 전송·취소
  sse.js edge/http.js routes*.js SSE 방송, 요청 가드(edge), 라우트
  active.js ext-live.js          실시간 방송: 기록 이벤트, 확장 기록(~/.omp/live-map) tail
  uploads.js                     프롬프트 첨부: 작은 이미지는 rpc `images`, 나머지는 %TEMP%\omp-live-map-uploads\ 에 저장해 경로를 메시지에 붙임
  harness/                       Claude Code 하네스: claude.js(기록 읽기) · claude-run.js(실행) · switch.js(하네스 전환) · session-harness.js(＋ 세션의 하네스 배정) 등
  edge/                        HTTP 가드와 엔지니어링 인증·라우트
  application/               Engineering 서비스 조립(engineering-services), 관찰 읽기. 규칙은 engineering/ 에 둔다
  infrastructure/            SQLite(sqlite.js), 이 PC 에서 omp·claude·검증 명령 실행(host-process.js)
  engineering/               프로젝트·하네스·루프·Workflow·개발 Task, schema*.sql, 실행 결정(workflow-engine)
extension/
  live-map.ts          omp 확장: 세션의 툴 출력·글을 ~/.omp/live-map 으로(설치: install.js)
desktop/               Electron 데스크톱 앱(main.cjs · preload.cjs · 설치 파일 빌드 설정)
tests/                 node --test 회귀 테스트(*.test.js, fake-omp·fake-claude 가짜 하네스) · verification/ Windows·Electron·브라우저 검증 스크립트
.github/workflows/     CI: V3 Windows verification(v2-phase-0.yml) 외 3개
ui/
  index.html           스크립트를 계층 순서로 적재(번들러·프레임워크 없음)
  shell/tasks.html     관제 화면의 Task 탭(폴더 = 프로젝트 · 한 줄 Task 칸반 · 요약 줄 · 승인 대기함). js/engineering.js, sdlc.js, sdlc-card.js, engineering-runtime.js(위쪽 막대의 실행 환경 점). 별도 Engineering 페이지는 없다(/engineering.html 은 / 로 넘긴다)
  js/core/engineering-api.js  웹·데스크톱 공통 Engineering HTTP 호출(window.engineeringApi). 데스크톱은 폴더 선택 대화상자만 더한다
  css/                 tokens · shell · sessions · cards · panel · blocks
  js/core/             format · dom · state(가변 상태 단일 소유) · persist(localStorage)
  js/model/            layout(배치 계산, DOM 접근 없음) · activity(마지막 턴 활동 범위)
  js/viewmodel/        map · session-rows · store · term · files · dbui · chat · context · dock(서브 도킹 상태) · claude-queue
  js/view/             맵(render-map, patch-nodes, stage*, edges, minimap, menu, search, topbar)
                       카드(card-compact, card-session, card-metrics, charts, spark-hover, panel), 세션 목록(session-list)
                       블록(blocks, block-controls, block-chat/term/bg/editor/browser/db/context, editor-*(탐색기·탭·Monaco 상태바))
  js/app.js            부트스트랩: 첫 스냅샷 → SSE → 폴러
docs/                  archify 구조 다이어그램(architecture · components · layers · ui), adr/, 릴리스 노트(release-v*.md), media/(README 이미지·GIF)
```

규칙:

- 의존 방향은 core → model → viewmodel → view → app 한쪽입니다. model은 DOM을 모르고 view만 DOM을 만집니다. viewmodel은 view를 부르지 않고 `viewUpdates`(core/state.js)로 화면 갱신을 알리며, `app.js`가 구독을 연결합니다. `index.html`은 이 순서로 적재하고 `app.js`가 마지막 일반 스크립트입니다(`tests/ui-layers.test.js`).
- 파일 하나는 200줄 미만을 원칙으로 합니다. 2026-11-27 기준 JS 239개 중 20개가 넘고, 가장 큰 파일은 `ui/js/studio.js`(1,493줄)입니다. 새 파일은 500줄을 넘기지 않고, 이미 넘은 파일은 더 키우지 않습니다(`tests/file-size.test.js`).
- 서버의 가변 상태는 모듈 하나가 소유하고 함수로만 내보냅니다(예: 파일 상태 Map은 `tail.js`).
- `server/engineering/`(규칙·실행)은 `application/`·`edge/`·`routes*`를 require 하지 않습니다. Workflow 실행 상태 전이는 `server/engineering/state.js`의 `workflowTransitions` 표에 적고, 표 밖 전이는 `workflow.transition.unexpected` 이벤트로 남깁니다(CI는 `OMP_STRICT_TRANSITIONS=1`로 실패시킴). 규칙은 `tests/server-layers.test.js`가 검사합니다.
- 실행기(adapter) 목록은 `server/engineering/adapter-registry.js` 한 표에 적습니다. 하네스 정의 검증, ＋ 세션 하네스의 공급자 결정, 추론 수준 지원 여부, 런타임 상태 보고가 이 표를 읽습니다. 새 실행기는 표에 항목을 더하고 `adapters.js`의 `runners`에 실행 함수를 더합니다(`tests/adapter-registry.test.js`).
- 상태를 바꾸는 운영 API(`/api/exec`, `/api/bg/start|stop`, `/api/release`, `/api/infra/action`, `/api/db/query`)는 `X-Omp-Ops-Token` 헤더가 맞아야 합니다. 토큰은 서버 기동 때 만들고(`OMP_MAP_OPS_TOKEN`으로 지정 가능) 화면 셸 `index.html`의 `<meta name="omp-ops-token">`에 심습니다(`server/edge/ops-token.js`, `tests/ops-token.test.js`). `/api/engineering/*` 전체도 같은 토큰을 요구하며, 웹 모드와 데스크톱 앱이 똑같이 같은 출처 HTTP로 부릅니다(데스크톱 IPC 프록시 없음, `tests/engineering-web-security.test.js`). 데이터 폴더는 `OMP_MAP_ENGINEERING_DATA`(데스크톱 앱이 사용자 데이터 폴더로 지정), 없으면 `OMP_MAP_STATE`(기본 `data/`) 아래 `engineering/`입니다.
- 엔지니어링 DB는 스키마를 올리기 전에 `engineering.sqlite.v<이전 버전>.bak`을 남깁니다. 에이전트 프로필은 하네스로 합쳤습니다. 앱을 열 때 남은 `definition`(kind=`profile`)과 예전 `session-harness.sqlite` 프로필을 같은 이름의 하네스(없으면 새 개인 하네스)로 옮기고, 프로필 노드를 쓰던 Workflow 버전은 Agent 단계가 그 하네스를 고정하도록 고친 뒤 프로필 정의를 지웁니다. ＋ 세션의 하네스 배정은 `session-harness.sqlite`에 남습니다(`server/engineering/harness-merge.js`, `server/harness/session-harness.js`, `tests/harness-merge.test.js`). v15에서 칸반 칸(`sdlc_stage`)은 프로젝트별로 더하고 지우는 칸이 되었고(칸별 Workflow 바인딩 제거), Task에 카드별 시간 한도·예산(NULL = 기본값)이 생겼습니다.
- v14부터 Workflow도 개인·팀·프로젝트 범위를 가집니다(`workflow.scope`·`team`, 처음 저장할 때 정하고 바꾸지 않음). 프로젝트에서는 그 프로젝트·같은 팀·개인 Workflow가 보이고, 팀·개인 Workflow는 같은 범위에서 쓸 수 있는 정의·하위 Workflow만 참조합니다. 실행(`workflow_run.project`)은 시작한 프로젝트를 직접 적습니다(`tests/workflow-scope.test.js`).
- 화면은 `renderMap()`이 조각 목록을 만들고 `patchPieces()`가 마크업이 바뀐 조각만 바꿉니다. 큰 카드는 스냅샷이 올 때 chrome만 교체하고, 블록이 사는 body는 블록 구성이 같으면 DOM을 유지합니다. 그래서 입력 포커스·스크롤·트리 펼침이 갱신에 끊기지 않습니다.
- 새 블록은 `ui/js/view/block-<이름>.js`에서 `registerBlock({ type, slot, flex, render, mount, paint })`로 등록하고 `index.html`에 스크립트를 추가합니다. `render`는 바디를 만들 때, `mount`는 그 직후 1회, `paint`는 스냅샷 갱신 때 불립니다.
