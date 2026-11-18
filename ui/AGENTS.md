# ui

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [프로젝트](../AGENTS.md)  
**자식**: [css](css/AGENTS.md) · [js](js/AGENTS.md)

`index.html`은 화면 골격과 스타일·스크립트 로딩 순서를 소유한다. 서버가 제공하는 UI이며, 부트스트랩과 계층별 구현은 [js](js/AGENTS.md)를 참고한다.

하네스 표시·기능 판단은 `js/model/harness.js`의 `capsOf`·`harnessChip` 한 곳에서 한다(서버 스냅샷의 `DATA.harness` 표 + 노드 `harness`). omp 전용 버튼(모델 변경·압축·비우기)은 이 플래그로 잠그고 이유를 title에 쓴다. 새 하네스는 서버 경계만 늘리면 카드 칩과 버튼 상태가 자동으로 따라온다.
<!-- AUTO:END -->
