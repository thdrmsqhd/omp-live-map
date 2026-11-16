# ui/js/viewmodel

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [js](../AGENTS.md)  
**자식**: 없음

상태 전이, 서버 요청과 화면에 필요한 데이터 조립을 담당한다. `store.js`는 그래프·인프라·호스트 스냅샷을 받고, `map.js`와 `session-block.js`는 맵과 세션 클러스터 데이터를 구성한다. `term.js`, `files.js`, `dbui.js`, `attach.js`, `chat.js`, `chat-model.js`, `context.js`, `live.js`는 각 기능의 명령과 상태를 처리한다.

완전히 독립된 순수 계층은 아니다. 예를 들어 `store.js`는 상태를 갱신한 뒤 `renderMap`을 호출한다. 스냅샷과 렌더 호출 관계를 바꿀 때 실제 뷰 갱신 경로를 함께 살핀다.
<!-- AUTO:END -->
