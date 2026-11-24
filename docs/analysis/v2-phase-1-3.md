# OMP Live Map V2 구현 현황

Phase 0의 Windows 회귀 기준선에서 출발했습니다. 기존 세션·터미널 기능과 기존 API를 유지하며 데스크톱을 통해 새 Engineering 화면을 엽니다. V2의 단일 Loop는 실제 OMP와 Claude Code에서 Worktree 수정, 검증 실패, 재시도, 성공까지 재현했습니다.

## 실행

개발 실행은 저장소 루트에서 `npm --prefix desktop install` 후 `npm --prefix desktop start`입니다. Windows 빌드는 `npm --prefix desktop run build:windows`입니다. GitHub Actions의 설치 작업이 개발 설치 파일을 제공합니다. 배포용 서명과 데이터 이관은 인수 작업에 포함됩니다.

## 검증 및 완료 판정

| 범위 | 구현 및 검증 | 남은 제품 인수 조건 |
| --- | --- | --- |
| Phase 1 | SQLite 스키마·트랜잭션·백업 및 재오픈, 정의 버전과 참조 보존, 상태 전이, 이벤트 커서, 멱등 실행 요청, 데스크톱·기존 맵, 프로젝트 등록/수정/보관, 토큰 기반 Engineering API | Windows Docker Desktop 및 실제 계정 인수 검증 |
| Phase 2 | 실제 OMP RPC와 Claude stream-json, 모델·하네스 버전 편집, 제한된 Worktree와 Anthropic 중계기, DPAPI 키 저장, AGENTS.md·Skills 지시 반영 | 세션 카드를 잇는 통합 관측, 실제 과금 검증, MCP·Hooks 적용 |
| Phase 3 | Loop 정의·실행 이력 UI, 구조화된 검증 명령, 재시도·한도·취소·중단 상태, 재시작 시 불확실한 시도 재실행 차단, 실제 두 CLI와 격리된 Node 검증 프로세스로 실패 2회 후 성공 확인 | 테스트 중 모델 서비스는 검증용 응답을 사용. 실제 계정과 Windows Docker Desktop 조합의 인수 검증 |

## 최종 개발 빌드 검증

검증 커밋은 `6cbd0ff51dd4f0ddf24ad00b8553fe32c93a8306`입니다.

- [Windows CI 45319050546](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45319050546)에서 Windows Node 24 자동 테스트 16건과 Windows 데스크톱 및 설치 파일 테스트를 통과했습니다. 프로젝트·모델 정의 저장과 복원, API 키의 DPAPI 암호화·삭제, 로컬 Monaco 자산을 확인했습니다.
- [실제 CLI 검증 45319050841](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45319050841)에서 OMP와 Claude Code를 Docker에서 실행했습니다. 실제 두 CLI로 각각 작업 파일을 만들고 검증 실패 2회 이후 세 번째에 성공했습니다. 원본 Git 작업 트리는 깨끗한 상태를 유지했습니다.
- CLI와 검증 명령을 실제로 실행했고, Anthropic의 응답은 CI에서 검증용으로 제공했습니다. 실제 과금 계정과 Windows Docker Desktop을 함께 사용한 인수 시험은 남아 있습니다.
- [Windows 개발 빌드](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45319050546/artifacts/14886657764)는 서명하지 않은 설치 파일입니다.

## 실행 경계

- 실제 실행기와 모델 중계기는 로컬 Docker 격리 환경이 준비되었을 때 사용합니다. 테스트에서는 모델 공급자 응답을 검증용으로 주입합니다.
- 기존 사용자의 수동 OMP·Claude 카드 작업은 Live Map에서 계속 사용할 수 있습니다. 권한이 검증된 런타임에서만 새로운 Loop가 에이전트나 명령을 시작할 수 있습니다.
- 실행 상태가 중단된 시도는 `uncertain`으로 남깁니다. 검증 결과를 확인하기 전까지 동일한 작업을 자동으로 재실행하지 않습니다.
- 검증 시간 한도는 생성부터 계산하며 일시정지 시간도 포함합니다. 비용을 보고하지 않는 어댑터의 실행은 실패로 기록하며, 비용이 발생하는 공급자는 백엔드가 호출 전에 한도를 강제할 수 있을 때 연결합니다.

## Windows 검증 명령 격리

[전용 Windows 검증 실행 45316858378](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45316858378)에서 제품이 사용할 수 있는 오프라인 검증 명령 백엔드를 확인했습니다. 검증 커밋은 `9a09b6e35c11c88eaf233e20b5f6f0033434c6b0`입니다.

- 호스트가 승인한 실행 파일과 인수만 받아, 작업 공간에 쓰기 권한과 런타임 위치에 읽기·실행 권한을 부여했습니다.
- Node 검증 명령을 실행해 작업 공간 쓰기, 공간 밖 파일 읽기·쓰기 거부, 호스트 loopback 연결 거부 및 부모 환경의 비밀값 미전달을 확인했습니다.
- 허용 목록 밖 인수 및 하드링크가 포함된 작업 공간은 거부했습니다. 자식 명령이 파일을 생성하지 못했고 취소 후 격리된 Node 프로세스 PID가 사라지는 것을 확인했습니다. Windows Job의 프로세스 한도 때문에 일부 자식 실행 시도가 대기할 수 있어, 실행 시간 한도와 취소가 상시 적용돼야 합니다.
- 이 네이티브 런처는 네트워크가 없는 단일 프로세스 검증 시험입니다. 제품용 Loop는 아래의 Docker 격리 환경과 모델 중계기를 사용합니다.

## 실제 하네스 실행 설정

데스크톱은 실행할 때 Windows가 배정한 빈 로컬 포트를 사용합니다. 기존 Node 서비스는 7800 포트에서 함께 실행할 수 있습니다.

### Claude 계정으로 수동 사용

Windows 터미널에서 공식 Claude Code CLI의 `claude auth login`으로 Claude 계정에 로그인하고, `claude auth status`로 인증 상태를 확인합니다. 같은 Windows 사용자로 Live Map을 열고 새 세션의 하네스를 **Claude Code**로 선택합니다. 기존 세션도 Live Map에서 관측할 수 있습니다. 로그인과 자격 증명 관리는 공식 CLI가 처리합니다.

### Docker 자동 Loop

Windows 개발 빌드의 Engineering 화면에서 로컬 Docker Desktop의 Linux 엔진을 실행한 상태로 **실행 환경 준비**를 누릅니다. Windows 사용자 비밀 저장소에 Anthropic API 키를 저장합니다. Docker 이미지는 앱에 포함된 빌드 정의로 준비하며, 이후 실행에는 준비된 로컬 이미지를 사용합니다.

모델은 `anthropic/claude-sonnet-4-6` 또는 `anthropic/claude-haiku-4-5-20251001`을 선택합니다. 현재 지원하는 검증 명령은 `node --test`, `npm test`, `python3 -m unittest discover`입니다. 작업은 기존 Git 프로젝트에서 분리한 Worktree에 수행되며, 변경 파일은 실행 이력에 표시된 Worktree에 남습니다.

- 에이전트와 검증 명령은 각각 네트워크가 차단된 별도 컨테이너에서 실행합니다. 에이전트의 모델 요청은 데스크톱 호스트 중계기를 통해 승인된 Anthropic 메시지 API로만 전달합니다. API 키는 에이전트나 검증 컨테이너에 전달되지 않습니다.
- UI의 비용 기록 중 `reserved`는 요청 전 토큰 수와 출력 한도로 계산한 보수적인 예산 예약액입니다.
- AGENTS.md와 Skills는 프로필 버전에 저장하며 실행 지시에 반영합니다. MCP·Hooks는 검증된 설정 초안과 이전 버전을 열어 비교할 수 있습니다. 프로젝트 MCP·Hooks의 실행, 임의 런타임 이미지와 의존성 다운로드, 다른 공급자에 대한 모델 요청은 현재 실행 경로에서 제공하지 않습니다. 기존 수동 하네스의 동작은 유지합니다.
