# ui/js/model

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [js](../AGENTS.md)  
**자식**: 없음

- `layout.js`: 트리 및 인프라 노드 배치 계산.
- `layout-place.js`: 새 카드의 빈자리와 클러스터 경계 계산. 기존 카드 좌표는 밀지 않고, 큰 카드는 클러스터 경계에 포함하지 않는다. DOM에는 접근하지 않지만 공유 배치 상태를 읽고 갱신한다.
- `route.js`: 카드 사각형을 가급적 피하는 관계선 기하 계산. 완전 회피가 불가능하면 충돌이 가장 적은 경로를 선택한다.
<!-- AUTO:END -->
