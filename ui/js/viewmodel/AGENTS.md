# ui/js/viewmodel

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [js](../AGENTS.md)  
**자식**: 없음

상태 전이, 서버 요청과 화면에 필요한 데이터 조립을 담당한다. `store.js`는 그래프·인프라·호스트 스냅샷을 받고, `map.js`는 맵 노드·HOST/인프라 블록을 구성하고, `session-rows.js`는 사이드 세션 목록 행·세션 컨텍스트 비중·열린 큰 카드 아래 세션 잡 카드 자리를 계산한다. `term.js`, `files.js`, `dbui.js`, `attach.js`, `chat.js`, `chat-model.js`, `context.js`, `live.js`는 각 기능의 명령과 상태를 처리한다.

view 의 함수·변수를 직접 부르거나 읽지 않는다. 화면 갱신이 필요하면 `core/state.js`의 `viewUpdates`(예: `viewUpdates.chat?.(id)`, `viewUpdates.map?.(false)`)로 알리고, 구독은 `app.js`의 `wireViewUpdates()`가 연결한다. `dock.js`는 서브에이전트 도킹 상태(SUBDOCK·DOCK_FREE·DOCK_OFF)와 실행 중 판정, `claude-queue.js`는 Claude Code 서버 예약 지시 명령을 맡는다. 규칙은 `tests/ui-layers.test.js`가 검사한다.
<!-- AUTO:END -->
