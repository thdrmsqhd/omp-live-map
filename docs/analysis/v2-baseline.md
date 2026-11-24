# OMP Live Map V2 현행 분석

기준 커밋은 `5531cf70419d8e3febe4bfb44b1a21d5d634ae0b`입니다. Phase 0의 T001로 서버, UI, 확장, 테스트를 기준 소스에서 확인했습니다. 관련 요구사항은 REQ-001, REQ-010, REQ-030, REQ-038입니다.

## 릴리스 경계

V2는 Phase 0~3과 T051의 Windows 초기 설치·실행 검증을 포함합니다. 개발자가 작업과 역할을 지정하면 Worktree에서 단일 Loop를 실행하고 외부 검증 결과에 따라 재시도합니다. 시간·비용·시도 제한, 취소, 복구, 기존 세션 연결까지 갖춥니다. V2의 화면에는 단일 Loop의 설계·실행·관측에 필요한 기능을 배치합니다.

V3는 Phase 4~6의 Graph·SDLC·PR/CI·통합 인수와 설치 업데이트·이관을 포함합니다. V2에는 호출 전 예산 검사, 진행 중 정책, 시도별 비용 기록이 필요합니다. 프로젝트별 사용량 분석은 V3의 T049에서 확장합니다.

## 소스 인벤토리

| 영역 | 구현 근거 | V2 작업과 회귀 조건 |
| --- | --- | --- |
| 서버 및 자원 | `server.js`, `server/config.js`, `server/routes-ops.js`, `server/infra.js` | 기존 loopback, 포트 옵션, 프로세스·WSL·Docker·DB 기능을 보존합니다. 설치 앱이 시작한 프로세스의 소유권을 T012에서 관리합니다. |
| 스냅샷 | `tail.js` → `ingest.js` → `snapshot.js`, `harness/claude-merge.js` | OMP 부분 줄·파일 축소 처리, Claude 메인/서브 병합, 카드 ID·계보, 토큰·비용·TTFT와 누락 표현을 회귀 대상으로 둡니다. |
| 실시간 이벤트 | `routes.js`, `sse.js`, `live.js`, `ext-live.js`, `extension/live-map.ts` | SSE 접속 첫 프레임은 스냅샷입니다. 진행 중 출력·확장 활동·미답 질문을 다시 보내며 `chat`, `live`, `ask`가 각각 별도 엔벌로프입니다. 계보를 따라 카드 ID를 매핑합니다. 신규 실행 이벤트는 별도 API를 사용합니다. |
| 기존 하네스 | `routes-chat.js`, `rpc.js`, `harness.js`, `harness/claude-*.js`, `harness/switch.js` | 기존 OMP RPC, Claude CLI 및 기능 플래그를 재사용합니다. 현재 Claude 컨텍스트 열람 플래그는 false입니다. V2의 공통 실행 계약과 권한 강제는 별도 개발 사항입니다. |
| 편집기 및 카드 | `ui/index.html`, `ui/js/core/persist.js`, `ui/js/view/editor-mount.js`, `server/routes-editor.js` | 계층별 스크립트 순서, 카드 배치와 편집기 동작을 유지합니다. Monaco 0.52.2 CDN 로딩은 설치 앱의 첫 실행을 위해 로컬 자산으로 제공해야 합니다. Java 정의 이동도 구현되어 있습니다. |
| 영속 상태 | `server/lineage.js`, `server/harness/claude-model.js`, `ui/js/core/persist.js` | 계보와 Claude 모델 선택은 이미 `OMP_MAP_STATE` 또는 `data/`의 JSON에 기록됩니다. 브라우저 배치는 localStorage에 있습니다. 신규 Run 저장소는 기존 JSONL·설정·배치와 독립시킵니다. |
| 기존 테스트 | `tests/release.test.js`, `tests/fake-omp/`, `tests/fake-claude/` | 기존 자동 테스트는 가짜 프로세스 목록으로 잡 종료 범위를 검증합니다. 가짜 CLI의 수동 실행기와 시나리오를 확인했습니다. 신규 엔진의 장애 복구 테스트는 T003~T005 및 후속 Task에서 작성합니다. |

## 호환 계약

- `GET /api/graph`의 `sessions`, `harness`와 카드 ID는 관측용입니다. 경로와 응답 의미를 보존합니다. `GET /api/events`의 기존 프레임과 재접속 시 재생을 유지합니다.
- `/api/session/*`, `/api/prompt`, `/api/prompt/cancel`, `/api/chat/answer`, `/api/context`, `/api/summary`의 수동 사용 흐름과 busy·held·cancelled 응답을 유지합니다.
- `/api/tree`, `/api/editor/*`, `/api/img/*`, `/api/localfs`의 UI 계약을 유지합니다. 편집기는 stale mtime에 409를 반환합니다.
- `/api/exec`, `/api/bg/*`, `/api/release`, `/api/db/query`, `/api/infra*`, `/api/sys`, `/api/proc`, `/api/res`의 수동 기능을 보존합니다. 새 Loop의 권한은 이 제어 API와 구분합니다.
- `server/http.js`의 Host·Origin·Sec-Fetch-Site·본문 형식 및 크기 검사와 로컬 파일 토큰·CSP를 유지합니다. 신규 실행 API는 `/api/engineering` 아래에 추가합니다.

## 확인 결과와 남은 검증

- Linux Node 24에서 원본 `node --test`는 1건 통과했습니다. README의 수동 검증 외에 자동 테스트도 존재합니다.
- 기존 ADR-0002의 JSONL 관측 원본 결정은 유지합니다. 신규 실행 상태 저장과 검증 기반 재시도를 허용하는 경계는 T002에서 별도로 결정해야 합니다.
- Windows 호스팅 러너에서 Git Bash·브라우저 동작과 성능 기준선을 확인했습니다. 실제 WSL2·Docker 및 설치 패키지의 검증은 제품 인수에서 수행합니다.
- Gate 0 완료를 아래에 기록했습니다. 기준은 Task List의 기술 실행 가능성, 호환 계약, 기존 핵심 기능 회귀와 성능 기준선입니다.

## Phase 0 검증 현황

**Gate 0 통과. T001~T005 완료.** 검증 커밋은 `e12a5fdcb89a7a6c7a689951a41c4b0f451c2f30`입니다.

| Task | 상태 | 근거 |
| --- | --- | --- |
| T001 | 완료 | 위 소스 인벤토리와 호환 계약 |
| T002 | 완료 | [ADR-0003](../adr/0003-v2-desktop-state-and-isolation.md). Windows Electron·SQLite·AppContainer 기술 검증과 강제 불가 시 실행 거부 정책 |
| T003 | 완료 | `node --test`, 임시 상태·JSONL 디렉터리 및 loopback HTTP fixture |
| T004 | 완료 | 기존 API에서 두 가짜 CLI 실행, OMP 대기·취소, Claude 스트리밍·오류와 메인·서브 수집, SSE 재연결 자동 검증 |
| T005 | 완료 | 기존 API·세션·Git Bash·Monaco·카드 UI·모의 WSL/Docker 회귀와 10세션 성능 기준선 |

### 호스팅 Windows 검증

[GitHub Actions 실행 45312014159](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45312014159)의 Windows Server 2025 러너가 통과했습니다.

- Node 24 회귀 테스트 10건과 실제 Windows Git Bash를 기존 터미널 API에서 호출하는 테스트를 통과했습니다. WSL·Docker 명령 및 응답은 모의 환경에서 검증했습니다.
- SQLite 파일 DB를 다시 열었을 때 확정된 실행 상태만 남았습니다.
- Electron 43.8.12가 별도 Node 자식 프로세스로 기존 서버를 시작하고 Live Map 창을 열었습니다. 포트 충돌 시 기존 서버를 보존했고, 종료 시 소유 서버 PID와 포트를 정리했습니다.
- AppContainer에서 허용 작업 폴더에 쓰고, 폴더 밖의 파일 읽기·쓰기와 호스트 loopback 연결을 거부했습니다. 같은 바이너리로 실행한 자식 프로세스에서도 AppContainer 토큰을 확인했습니다.
- Chromium에서 세션 카드 열기, 실제 Monaco에서 파일 편집·저장, 새로고침 후 목록 패널 상태 복원을 확인했습니다. Monaco 자산은 테스트에서 로컬 파일로 제공했습니다.
- 모의 세션 10개에서 JSONL 스캔 시작부터 SSE를 거쳐 DOM에 반영되기까지 20회 측정한 p95는 **11.2ms**였습니다. 이 수치는 호스팅 러너의 기준선입니다.

### 후속 검증

- T012에서 제품용 데스크톱 셸과 서버 생명주기를 구현합니다. V2 초기 설치·실행·오프라인 자산 검증은 T051의 초기 배포 범위에서 수행합니다.
- T022에서 실제 OMP·Claude, 자식 프로세스·도구, 명령 허용 정책 및 모델 연결 네트워크 권한을 검증합니다. 테스트 바이너리에 대한 AppContainer 결과는 플랫폼 실행 가능성의 근거입니다.
- 기존 WSL2·Docker 실연동은 테스트 환경을 갖춘 후 T054의 배포 회귀에서 확인합니다. V2의 Windows 호환 인수 항목에도 기록합니다.
