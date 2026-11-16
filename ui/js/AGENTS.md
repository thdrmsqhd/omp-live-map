# ui/js

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [ui](../AGENTS.md)  
**자식**: [core](core/AGENTS.md) · [model](model/AGENTS.md) · [viewmodel](viewmodel/AGENTS.md) · [view](view/AGENTS.md)

`../index.html`의 일반 script 태그 순서는 core → model → viewmodel → view → `app.js`다. 파일은 모듈이 아니며 최상위 선언을 공유하므로 추가·이동 시 실제 스크립트 순서와 이름 충돌을 함께 확인한다. 각 계층 내부의 정확한 순서는 HTML이 기준이다.

`app.js`는 입력을 연결하고 `/api/graph` 초기 스냅샷, `/api/events` SSE 및 주기적 갱신을 시작한다. 포인터 조작 중에는 렌더를 지연한다.
<!-- AUTO:END -->
