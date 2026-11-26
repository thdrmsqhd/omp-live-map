# ui/js

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
## 세션 목록과 지도
- 세션 에이전트(main·sub)는 지도에 큰 카드로만 있고, 목록(`view/session-list.js`, 행 데이터 `viewmodel/session-rows.js`)이 일람을 맡는다. 열린 카드 상태(`openIds`·`BIGPOS`)가 목록 강조와 지도를 함께 결정하므로 열고 닫는 경로는 `openNode`·`closeCard`·`toggleCard` 한 곳을 쓴다.
- 목록 패널 폭·접힘은 `omp-map-sessions`, 큰 카드 좌표는 `omp-map-bigpos`에 저장한다. 세션 작은 카드 크기(`omp-map-subsize`)·카드 절대 좌표(`omp-map-manual`의 `card:` 키)·세션 원점은 더 쓰지 않는다.
- 세션 잡 카드는 그 세션에 열린 큰 카드가 있을 때만 지도에 올라온다(앵커 없음 → 미표시).

## 코드 편집기
- `view/editor-api.js`(fetch 래퍼) → `view/editor-mount.js`(Monaco jsDelivr CDN 지연 로드·언어 매핑·LSP→마커 변환) → `view/editor.js`(카드별 상태·DOM 골격·탭·상태바·Monaco 생성) → `view/editor-chrome.js`(탐색기 폭·접힘, 탭 클릭, 고정 탭, 브레드크럼) → `view/editor-split.js`(대화·편집기 경계 끌기) → `view/editor-explorer.js`(탐색기 트리·필터·우클릭 메뉴) → `view/editor-actions.js`(저장·F12 정의 이동·600ms 진단 디바운스) → `view/editor-open.js`(탭 닫기·`edDispose`·`openEditor(카드id, 경로, {pin})`) → `view/block-editor.js`(큰 카드 `editor` 블록, main 슬롯) 순서로 로드한다. `files` 블록은 없다: 파일 트리는 편집기 탐색기가 맡고 데이터(`TREES`·`loadTree`·`setCwd`)는 `viewmodel/files.js` 에 둔다. 저장된 블록 구성의 `files` 는 `cardBlockTypes` 가 `editor` 로 이전하고, 서브에이전트(sub) 카드에는 editor 를 넣지 않는다. 편집기는 chat 이 있는 카드에서 슬롯 `edit`(대화 오른쪽 `.col-ed`, 폭 `--edcol`)에, 없으면 `main` 에 놓인다. 편집기 안 요소 속성·클래스는 카드 전역 핸들러(`data-act`·`data-close`·`.x`)와 겹치지 않게 `data-edact`·`data-edclose`·`edx` 처럼 `ed` 접두어를 쓴다.
- 편집기는 카드 안 블록이다. 카드별 상태(`ED`: root DOM·Monaco·탭·미리보기 탭·탐색기 펼침/필터)와 파일 레코드(`ED_FILES`: 경로당 모델·mtime·dirty를 카드끼리 공유)는 `editor.js`가 단독 소유한다. 바디가 다시 만들어져도 root DOM은 살아 있고 `block-editor.js`의 mount가 다시 붙인다(`paint`는 숨김 여부만 맞춘다). 카드를 닫을 때 `closeCard`가 `edDispose`를 불러 인스턴스·모델을 dispose 한다. 편집기 안 휠은 root에서 끊고 포인터는 `CARD_INTERACTIVE`(`.edblk`)로 막아 지도·카드 끌기로 새지 않는다. 다른 파일은 DOM 상태를 새로 만들지 말고 이 함수를 쓴다. Monaco는 처음 열 때만 CDN에서 받고, npm 의존성은 두지 않는다.
## Engineering 노드 캔버스
- `engineering.html`의 기본 화면(`#studio`). `studio-canvas.js`(이동·휠 확대) → `studio-nodes.js`(노드 종류별 소켓·노드 안 위젯·필수값 경고) → `studio.js`(상태·연결·저장). ES 모듈이며 `engineering.js`가 `bindStudio`로 묶는다.
- 저장은 기존 API만 쓴다: 정의(`definitions`), 프로필(`/api/session-harnesses`), Workflow(`workflows`·`workflows/plan`). 새 API를 추가하면 `desktop/main.cjs`의 `endpoints` 허용 목록에도 넣는다.
- 연결은 노드의 `ref`(하네스.model, 루프.harness, 단계.harness·loop·profile)와 Workflow `edges`가 원본이고, 선과 노드 안 셀렉트는 둘 다 이 값을 그린다. 범위 규칙(하네스-모델 같은 범위, 루프→하네스 사용 가능 범위)은 서버 `catalog.js`와 같게 `linkProblem`에서 확인한다.
- 관제(Live Map)의 Workflow 레이어(`view/workflow-map*.js`, `css/workflow-map.css`)도 같은 색(모델 초록·하네스 보라·루프 주황·프로필 분홍·실행 순서 하늘)과 같은 배율(`wfScale` x2·y2.6)을 쓴다. 소켓 줄 위치는 `wfSocketY`(머리 38px + 22px 줄)와 CSS가 같아야 선 끝이 맞는다. 실행 중 출력은 `workflow-run` 응답의 `live`(서버 `engineering/workflow-live.js`, 메모리 전용)로 그린다. `#workflow-map-nodes`에는 단계 버튼만 둔다(데스크톱 검증이 자식 수를 센다).
- Workflow 문서의 profile 노드는 캔버스에서 Agent의 `ref.profile`로 보여 주고, 저장할 때 `(profileId, 버전)`별로 다시 만든다. 단계 좌표는 `WORKFLOW_X + x*2`, `y*2.6`으로 풀고 저장 때 되돌린다. 정의 노드 위치·접힘은 `omp-studio-layout`(Workflow별 맥락)에만 둔다.

- F12는 Python이면 `/api/editor/definition` 으로, JS/TS면 Monaco 내장 TypeScript 서비스(`getTypeScriptWorker`)로 정의를 찾는다. Ctrl+클릭은 Python만 직접 처리한다. Python 진단은 서버가 주고 JS/TS 문법 오류는 Monaco가 스스로 마커를 단다.
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [ui](../AGENTS.md)  
**자식**: [core](core/AGENTS.md) · [model](model/AGENTS.md) · [viewmodel](viewmodel/AGENTS.md) · [view](view/AGENTS.md)

`../index.html`의 일반 script 태그 순서는 core → model → viewmodel → view → `app.js`다. 파일은 모듈이 아니며 최상위 선언을 공유하므로 추가·이동 시 실제 스크립트 순서와 이름 충돌을 함께 확인한다. 각 계층 내부의 정확한 순서는 HTML이 기준이다.

`app.js`는 입력을 연결하고 `/api/graph` 초기 스냅샷, `/api/events` SSE 및 주기적 갱신을 시작한다. 포인터 조작 중에는 렌더를 지연한다.
<!-- AUTO:END -->
