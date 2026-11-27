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
## 한 맵 (프로젝트 띠 > Task > Workflow 단계 > 세션)
- 화면은 두 모드뿐이다: `map`(한 맵 `#umap`)과 `workspace`(세션 하나 전체 화면 `#stage`). 전환은 `view/monitor.js`의 `setMapMode`(저장 키 `omp-map-view-mode-v3`). 맵으로 돌아오면 떠날 때의 맵 위치(`UM.returnTo`)를 되살린다. 탭·설계 캔버스·칸반은 없다.
- `model/task-map.js`(순수 계산, DOM·상태 없음): `umapOrderTasks`(개입 필요 → 진행 중 → 대기 → 완료), `umapLayout`(띠 > Task 줄 > 단계 > 단계 아래 세션, 완료 Task 한 줄·끝난 세션 칩, 옮긴 카드는 자기 띠 기준 dx·dy), Workflow 편집 목록 연산(`umapInsertStage`·`umapMoveStage`·`umapRemoveStage`·`umapDropIndex`). 크기 상수는 `UMAP`이고 CSS(`css/umap.css`)와 같아야 선 끝이 맞는다.
- `viewmodel/task-map.js`: 상태 `UM`(프로젝트·task-map 응답·서랍·편집·보기)과 `localStorage`(`omp-umap-manual-v1` 옮긴 카드, 띠 순서·접힘, 맵 보기). `umapBands`가 스냅샷 노드의 `sid`(JSONL 세션 id)와 서버가 준 단계별 `sessionId`를 맞춰 세션을 단계 아래에 놓고, 남은 세션은 폴더별로 프로젝트 띠에(프로젝트가 아니면 폴더 띠) 둔다. 화면 갱신은 `viewUpdates.umap()`으로만 알린다. 서버 호출은 `viewmodel/task-map-actions.js`.
- view: `umap-render.js`(그리기) · `umap-input.js`(이동·확대·카드 끌기, 포인터 캡처는 움직이기 시작한 뒤, 맵 키) · `umap-click.js` · `umap-edit.js`(＋ Task 한 줄, Workflow 편집) · `umap-drawer.js`(단계·하네스·루프·Task 서랍, 저장 범위 이 Task만/템플릿, 0.7초 자동 저장) · `umap-library.js` · `umap-topbar.js`(자원 한 줄 `CPU · RAM · WSL · Docker`과 서랍, 기존 인프라 동작 유지).
- 서버: `GET /api/engineering/task-map?project=`(읽기), `POST tasks/stage`·`tasks/workflow`(저장 범위 `task`|`template`), `POST workflows/remove`(Task가 쓰는 Workflow는 거부). 웹·데스크톱 모두 `core/engineering-api.js`로 같은 출처 HTTP를 부르므로 새 API는 서버 라우트(`server/edge/engineering-routes.js`)에만 더한다.
- 큰 카드의 무거운 블록은 workspace 모드의 활성 카드에서만 만든다(`card-virtualization.js`). 맵의 세션은 가벼운 카드·칩이다.

- F12는 Python이면 `/api/editor/definition` 으로, JS/TS면 Monaco 내장 TypeScript 서비스(`getTypeScriptWorker`)로 정의를 찾는다. Ctrl+클릭은 Python만 직접 처리한다. Python 진단은 서버가 주고 JS/TS 문법 오류는 Monaco가 스스로 마커를 단다.
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [ui](../AGENTS.md)  
**자식**: [core](core/AGENTS.md) · [model](model/AGENTS.md) · [viewmodel](viewmodel/AGENTS.md) · [view](view/AGENTS.md)

`../index.html`의 일반 script 태그 순서는 core → model → viewmodel → view → `app.js`다. 파일은 모듈이 아니며 최상위 선언을 공유하므로 추가·이동 시 실제 스크립트 순서와 이름 충돌을 함께 확인한다. 각 계층 내부의 정확한 순서는 HTML이 기준이다.

`app.js`는 입력을 연결하고 `/api/graph` 초기 스냅샷, `/api/events` SSE 및 주기적 갱신을 시작한다. 포인터 조작 중에는 렌더를 지연한다.
<!-- AUTO:END -->
