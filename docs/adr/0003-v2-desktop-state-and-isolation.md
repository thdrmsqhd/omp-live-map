# ADR-0003. V2 데스크톱·실행 상태·격리

상태는 채택입니다. T002 후보 선정과 실행 가능성은 Windows Server 2025에서 검증했습니다. 제품 통합과 인수 조건은 아래에 기록합니다. 관련 요구사항은 REQ-002, REQ-012, REQ-034, REQ-036입니다.

## 데스크톱

데스크톱 셸은 Electron으로 선정합니다. 기존 HTTP·SSE·Vanilla JS를 유지하고 별도 자식 프로세스로 Node 서버를 구동하는 구성이 기존 코드 변경을 줄입니다. Electron은 Chromium을 함께 배포하는 만큼 설치 용량과 보안 업데이트 비용이 있습니다. Tauri는 시스템 WebView를 쓰지만 기존 Node 서버를 sidecar로 패키징하고 별도의 런타임·IPC·플랫폼별 배포를 관리해야 합니다.

- Windows PoC는 Electron에서 별도 Node 자식 프로세스를 시작하는 구성을 검증했습니다. Node 런타임은 테스트 러너에서 제공했습니다. 설치 패키지에 런타임을 포함하는 검증은 남아 있습니다.
- 앱이 직접 시작한 서버가 준비 신호를 보낸 뒤 로컬 창을 연결합니다. 포트 충돌 시 이미 실행 중인 서버에 임의로 연결하지 않으며 앱 종료는 소유한 자식에 한합니다.
- 렌더러의 Node 통합을 끄고 context isolation과 sandbox를 적용합니다. 새 제어 API에는 기존 HTTP 가드에 더해 앱 세션 인증을 적용합니다. 로컬 미리보기와 외부 내비게이션에는 제어 API 권한을 주지 않습니다.
- Monaco 자산을 설치 파일에 포함합니다. 설치 후 네트워크가 없는 환경에서 UI와 편집기를 열고, 가짜 CLI로 기존 세션 흐름을 확인합니다.
- 배포 포트와 사용자 데이터 경로를 결정할 때 기존 카드 배치가 브라우저의 출처별 localStorage에 있다는 점을 반영합니다.

## 실행 상태

새 실행 상태는 사용자 데이터 경로의 SQLite에 저장합니다. 최소 데스크톱 Node 버전은 내장 `node:sqlite`를 기본 활성화하는 22.13 이상을 검토하며 최종 설치 런타임에서 실제 로드를 확인합니다. 기존 관측 서버의 Node 호환 조건에 영향을 주지 않도록 신규 엔진의 시작 경계에서 SQLite 지원을 확인합니다.

- [ADR-0002](0002-jsonl-single-source-no-server-state.md)의 세션 관측 원본은 JSONL로 유지합니다. 새 DB에는 프로젝트·정의·실행·시도·승인·감사 이벤트를 저장합니다.
- 사용자가 시작한 단일 Loop가 검증 결과에 따라 한도 내에서 추가 프롬프트를 호출할 수 있도록 ADR-0002의 수동 실행 원칙에 한정된 예외를 둡니다.
- 시도 상태와 외부 호출 식별자를 트랜잭션으로 기록합니다. 재시작 시 완료 시도는 건너뛰고 결과가 불확실한 외부 호출은 사용자 확인을 기다립니다. 쓰기 잠금, 스키마 이관, 백업·복원은 T007에서 검증합니다.
- Linux Node 24에서 파일 DB의 커밋, 롤백, 재오픈을 확인했습니다. Windows Server 2025의 Node 24에서도 확정 및 미확정 트랜잭션의 재오픈 동작을 확인했습니다. 설치 패키지 런타임과 백업·복원 검증이 남았습니다.

## 자동 실행 권한

Windows 네이티브 자동 실행의 권한 강제 후보로 AppContainer와 제한된 작업 디렉터리를 선정합니다. Git Worktree는 변경 분리용입니다. Electron 렌더러 sandbox가 OMP·Claude CLI의 파일·명령·네트워크를 제한하지 않으므로 실행 경계에서 별도의 강제가 필요합니다.

- 파일 접근과 네트워크는 OS 격리 환경에서 제한합니다. 엔진이 실행할 검증 명령은 허용된 실행 파일과 구조화 인수로 정의하고, 하네스 내부 도구에도 같은 정책을 강제할 수 있음을 입증합니다.
- Windows Server 2025에서 AppContainer 테스트 프로세스가 허용 작업 폴더에 쓰고, 외부 파일 읽기·쓰기와 호스트 loopback에 접근하지 못했으며, 자식 토큰에 격리가 유지됐습니다. 네트워크 기능 권한을 부여하지 않은 프로필로 검증했습니다.
- AppContainer PoC로 확보한 것은 기본 파일 ACL과 네트워크 차단의 실행 가능성입니다. 실제 Git Bash·OMP·Claude, 명령 허용 목록, 모델 공급자 접속, 링크 경유, 자식 프로세스 취소는 T022에서 검증합니다. WSL 또는 컨테이너를 대안으로 평가하면 호스트 마운트·호스트 실행 연동·네트워크·자격 증명 경계를 함께 검증합니다.
- 런타임에서 파일·명령·네트워크 권한을 강제할 수 있음이 확인된 실행기만 자동 실행을 허용합니다. 기존 Live Map의 사용자 직접 제어 API는 새 Loop 실행기에 제공하지 않습니다.
- 검증 기록은 [Phase 0 Windows 실행 결과](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45312014159)에 있습니다.

## 근거

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)
- [Node.js SQLite](https://nodejs.org/api/sqlite.html)
- [Microsoft AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
