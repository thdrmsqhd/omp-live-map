# extension

<!-- AUTO:START -->
<!-- AUTO:END -->

<!-- MANUAL:START -->
<!-- MANUAL:END -->

<!-- AUTO:START -->
**부모**: [프로젝트 루트](../AGENTS.md)

## 역할
`live-map.ts`는 OMP 세션의 실시간 활동을 `~/.omp/live-map/`의 JSONL에 기록합니다. `server/ext-live.js`가 읽어 화면에 전달합니다.

## 주요 파일과 규칙
- `live-map.ts`: 이벤트를 수집하고 비동기 큐로 기록합니다. TUI 프로세스에서 실행되므로 예외가 밖으로 나가지 않도록 유지합니다.
- 레코드의 `node`와 `kind`는 서버와 공유하는 계약입니다. 파일 크기가 줄면 서버가 처음부터 다시 읽습니다.
- `install.js`: `PI_CODING_AGENT_DIR` 또는 기본 사용자 디렉터리의 `extensions/`에 확장을 복사합니다. `node extension/install.js` 실행은 사용자 환경을 변경하며, 새 OMP 세션부터 적용됩니다.

## 하위 지침
없음.
<!-- AUTO:END -->

