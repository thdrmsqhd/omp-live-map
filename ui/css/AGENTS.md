# ui/css

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [ui](../AGENTS.md)  
**자식**: 없음

`../index.html`에서 `tokens.css` → `shell.css` → `cards.css` → `panel.css` → `blocks.css` → `jobs.css` 순서로 로드한다. 순서는 CSS 캐스케이드에 영향을 준다.

- `tokens.css`: `:root` 색상·글꼴 변수와 기본 요소 스타일. `:root` 블록을 유지한다.
- `shell.css`: 화면 셸, `cards.css`: 카드, `panel.css`: 패널, `blocks.css`: 카드 블록, `jobs.css`: 작업 관련 스타일.
<!-- AUTO:END -->
