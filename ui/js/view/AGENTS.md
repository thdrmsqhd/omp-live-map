# ui/js/view

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [js](../AGENTS.md)  
**자식**: 없음

DOM 렌더링과 입력 처리를 담당한다. `render-map.js`가 맵을 그리고 `patch-nodes.js`의 `patchPieces`가 카드 요소를 재사용한다. 큰 카드의 `keep` 자식은 `data-sig`가 같으면 유지되므로 입력·스크롤과 이벤트 리스너가 보존되도록 이 경계를 지킨다.

`blocks.js`의 `registerBlock`으로 `block-*.js` 블록을 등록한다. `render`는 바디 생성 시 마크업, `mount`는 새 DOM의 초기 연결, `paint`는 유지된 DOM 갱신을 맡는다. 카드당 같은 타입은 하나이며 블록 구성·접힘·높이가 바뀌면 바디 서명도 바뀐다. `block-controls.js`는 블록 조작을 연결한다. `block-editor.js`는 카드 안 코드 편집기 블록이다(`ui/js/AGENTS.md` 참조).

`session-list.js`는 왼쪽 세션 목록(클릭=큰 카드 열기·이동, ✕=닫기, 접힘·폭 저장)을 그리고, 지도에는 열린 큰 카드와 로컬·인프라·HOST·잡 카드만 올린다(세션 작은 카드·미러·세션 클러스터 테두리 없음). 새 큰 카드는 `panel.js`의 `placeInView`가 현재 화면 안 빈 자리에 놓는다.

`stage*.js`는 무대 입력, 배치 이력, 클러스터(HOST·인프라·로컬)·큰 카드 이동과 큰 카드 크기 조절을 나눠 담당한다. 큰 카드 끌기는 그 카드(+도킹 서브)만 옮긴다. `edges.js`·`minimap.js`, 카드·패널·검색·메뉴 파일도 각각 표시 및 상호작용을 구현한다.
<!-- AUTO:END -->
