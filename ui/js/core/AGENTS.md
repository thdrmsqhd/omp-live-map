# ui/js/core

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [js](../AGENTS.md)  
**자식**: 없음

공유 상태와 공통 유틸리티를 둔다. `state.js`는 그래프, 좌표, 열린 카드와 렌더 지연 등 렌더 간 가변 상태를 보유한다. `format.js`, `dom.js`, `markdown.js`는 각각 표시 형식, DOM 헬퍼, 마크다운 처리를 담당한다.

`persist.js`는 localStorage 값을 로드·저장한다. 배치 v2 전환은 세션 데이터가 들어온 후 기존 값을 한 번 백업하고 저장 성공 시 버전을 기록한다. 저장 키나 전환 순서를 바꿀 때 기존 사용자 배치를 보존해야 한다. `state.js`는 `persist.js`보다 먼저 로드된다.
<!-- AUTO:END -->
