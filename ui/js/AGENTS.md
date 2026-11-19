# ui/js

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
## 코드 편집기
- `view/editor-api.js`(fetch 래퍼) → `view/editor-mount.js`(Monaco jsDelivr CDN 지연 로드·언어 매핑·LSP→마커 변환) → `view/editor.js`(오버레이 패널·탭·열기/닫기) → `view/editor-actions.js`(저장·F12 정의 이동·600ms 진단 디바운스) 순서로 로드한다. `block-files.js`의 우클릭 메뉴가 `openEditor(path)`를 부른다.
- 편집기 탭 상태(`ED_TABS`)와 Monaco 인스턴스는 `editor.js`가 단독 소유한다. 다른 파일은 DOM 상태를 새로 만들지 말고 이 함수를 쓴다. Monaco는 처음 열 때만 CDN에서 받고, npm 의존성은 두지 않는다.
- F12는 Python이면 `/api/editor/definition` 으로, JS/TS면 Monaco 내장 TypeScript 서비스(`getTypeScriptWorker`)로 정의를 찾는다. Ctrl+클릭은 Python만 직접 처리한다. Python 진단은 서버가 주고 JS/TS 문법 오류는 Monaco가 스스로 마커를 단다.
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [ui](../AGENTS.md)  
**자식**: [core](core/AGENTS.md) · [model](model/AGENTS.md) · [viewmodel](viewmodel/AGENTS.md) · [view](view/AGENTS.md)

`../index.html`의 일반 script 태그 순서는 core → model → viewmodel → view → `app.js`다. 파일은 모듈이 아니며 최상위 선언을 공유하므로 추가·이동 시 실제 스크립트 순서와 이름 충돌을 함께 확인한다. 각 계층 내부의 정확한 순서는 HTML이 기준이다.

`app.js`는 입력을 연결하고 `/api/graph` 초기 스냅샷, `/api/events` SSE 및 주기적 갱신을 시작한다. 포인터 조작 중에는 렌더를 지연한다.
<!-- AUTO:END -->
