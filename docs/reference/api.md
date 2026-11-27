# API와 보안

서버는 `127.0.0.1`에만 바인드합니다. 아래는 웹 모드와 데스크톱 앱이 같이 쓰는 관측·제어 API입니다.

## 데이터와 API

기록의 원본은 `~/.omp/agent/sessions/<폴더>/<세션>.jsonl`과 서브에이전트 `<세션>/<Agent>.jsonl`입니다. 서버는 읽기만 하고 상태를 메모리에만 둡니다. 서버를 다시 띄우면 기록에서 다시 만듭니다. 예외는 Claude 카드별 모델 선택과 비우기 계보(`data/` 또는 `OMP_MAP_STATE`)와, 데스크톱 앱의 Engineering 데이터(앱 사용자 데이터 폴더의 SQLite)입니다.

| 경로 | 내용 |
|---|---|
| `GET /api/graph` | 스냅샷 `{generatedAt, fx, env, sessions[]}` |
| `GET /api/events` | SSE. 스냅샷(바뀔 때만)과 `{chat: {node, kind: req\|delta\|done, text, code, cancelled}}` |
| `POST /api/prompt` `{node, text, files?[{name, mimeType, data(base64)}]}` | 세션에 프롬프트 전송. 노드당 1개만 실행(`busy`). PNG·JPEG·GIF·WebP 는 base64 합계 900KB까지 omp rpc `images` 로 싣고(rpc v1 입력 프레임 1MiB), 그 밖의 파일·넘친 이미지는 `%TEMP%\omp-live-map-uploads\<id>\` 에 저장해 메시지 끝에 절대 경로를 붙임. 본문 상한 100MB(다른 API는 1MB). `POST /api/session/new` `{cwd, text, files?}` 도 같음 |
| `POST /api/prompt/cancel` `{node}` | 실행 중인 프롬프트의 프로세스 트리를 끝냄. 대기 중인 `/api/prompt` 응답과 SSE가 `code 130, cancelled`로 끝남 |
| `POST /api/session/models` `{node}` | 사용 가능한 모델 목록과 현재 모델 `{ok, models[{provider,id,name}], current, busy}`. 맵 세션이 아니면 이어 붙이고, 터미널이 쥔 세션은 `{ok:false, held:true}` |
| `POST /api/session/model` `{node, provider, id}` | 모델 변경(omp rpc `set_model`). 응답 `{ok, model, busy}`. 도는 중이면 다음 턴부터 적용 |
| `GET /api/context?node=` | 그 세션의 지금 컨텍스트 `{ok, items[{i, kind, label, text, tokens, chars, trunc, tool?, tools?, error?}], count, totalTokens, owned}`. 기록에서 마지막 `compaction`(없으면 `reset_boundary`) 이후만 복원하고, 토큰은 표시용 근사치(한글·CJK 1자≈1, 그 외 4자≈1) |
| `POST /api/context` `{node, mode, text, omit?}` | `mode:"guide"` = 작업 가이드를 프롬프트로 전송(도는 중이면 steer). `mode:"compact"` = omp `compact` 에 `customInstructions` 로 가이드+제외 항목 설명을 넘겨 압축(맵이 쥔 세션만, 터미널이 쥐면 `{ok:false, held:true}`) |
| `POST /api/summary` `{node}` | 최근 대화 3줄 요약 |
| `POST /api/exec` `{cwd, cmd}` | Git Bash 명령 실행(20초 제한). 서버는 cwd를 기억하지 않고, `cd`는 새 cwd를 응답으로 돌려줌 |
| `POST /api/db/query` `{type, host, port, database, user, password, path, sql}` | DB 조회 한 문장. 응답 `{ok, columns, rows, total, truncated, changes, ms, error, reason, hint}`. `type`은 `sqlite`\|`mysql`\|`mariadb`\|`oracle`, `path`는 SQLite 파일. SQLite는 내장 `node:sqlite`(없으면 `sqlite3` CLI), MySQL·MariaDB는 `mysql`/`mariadb` 클라이언트, Oracle은 `sqlplus`를 부릅니다. 비밀번호는 요청에만 쓰고 저장하지 않음 |
| `POST /api/bg/start` `{node, cwd, cmd}` · `GET /api/bg/list?node=` · `GET /api/bg/all` · `POST /api/bg/stop` `{id}` | 백그라운드 잡 |
| `GET /api/tree?p=&d=` | 디렉터리 트리 |
| `POST /api/editor/read` `{path}` | 파일 읽기 `{ok, path, text, mtime}`. 절대 경로만 받고 2MB 상한, 폴더·바이너리는 거부 |
| `POST /api/editor/write` `{path, text, mtime}` | 파일 저장 `{ok, mtime}`. 보낸 `mtime` 이 현재와 다르면 409(다른 곳에서 바뀜), `mtime:null` 이면 덮어씀 |
| `POST /api/editor/definition` `{path, text, line, character}` | Python 정의 위치 `{ok, locations[{path, line, character}]}`. pyright-langserver 를 워크스페이스 루트별로 띄워 처리(0-based) |
| `POST /api/editor/diagnostics` `{path, text}` | Python 진단 `{ok, items[{line, character, endLine, endCharacter, severity, message}]}`. `publishDiagnostics` 를 15초까지 기다림 |
| `GET /api/editor/status` | `{ok, pyright}` — Python 언어 서버(pyright-langserver) 발견 여부 |
| `POST /api/release` `{node}` | 이 카드에서 띄운 백그라운드 잡과, 명령줄에 세션 폴더가 들어간 프로세스(자식 포함)를 종료. 세션을 돌리는 omp 프로세스와 그 자식(MCP 서버·실행기)은 건드리지 않음 |
| `GET /api/res?cwd=&node=` · `GET /api/proc` · `GET /api/sys` | 자원·프로세스·호스트 |
| `GET /api/infra` · `POST /api/infra/action` `{kind, target}` | WSL 배포판·Docker 컨테이너 조회와 start/stop/restart, Compose 프로젝트 실행(`project-start`) |
| `GET /api/performance` | 서버 프로세스 메모리·CPU·이벤트 루프 지연(P95), SSE 지표, 데스크톱 프로세스 지표, 세션별 자원 |
| `GET /api/claude/status` | Claude Code CLI 상태 `{ok, installed, version, auth{loggedIn, method}}` |
| `POST /api/claude/options` · `/api/claude/project-info` · `/api/claude/queue` | Claude Code 카드용 옵션·프로젝트 정보·프롬프트 대기열 |
| `POST /api/session/stop` · `/api/session/switch` | 세션 종료 · 하네스 전환(omp ↔ Claude Code) |
| `GET`·`POST /api/session-harnesses` | 세션 하네스 프로필 목록·변경 `{ok, profiles[]}`. 데스크톱(엔지니어링 DB)에서는 정의 저장소(`definition` kind=`profile`)를 쓰고 새 프로필에 `scope`(`personal`·`team`)·`team`을 받습니다. 웹 모드는 `session-harness.sqlite`를 씁니다 |
| `POST /api/chat/activity` · `/api/chat/answer` · `/api/chat/diff` | 대화 블록 보조: 턴별 활동 기록, 질문 카드 답변, 세션 폴더의 파일 diff |
| `/api/engineering/*` | 데스크톱 앱 전용. 앱의 토큰 헤더가 없으면 403 |

컨텍스트 편집은 omp 가 실제로 지원하는 두 경로만 씁니다(rpc 에 메시지 삭제·수정·시스템 프롬프트 교체 명령이 없습니다): 작업 가이드 프롬프트/steer 와 `compact` + `customInstructions`. 기록 파일(.jsonl)은 직접 고쳐 쓰지 않습니다.

스냅샷 노드의 주요 필드: `id`(기록 파일 경로), `kind`(main\|sub), `parent`, `status`(live\|idle\|done), `tokens`, `tokens1h`, `cost`, `auxCost`, `ctx`, `ctxWindow`, `series`, `tools`, `messages[{role, text, ts, tools?, n?}]`, `res{cpu, mb, proc, procs, owner, hist}`.

세션과 프로세스는 omp 본체 프로세스의 명령줄(세션 id·파일 경로) 또는 생성 시각(세션 시작 15초 전~3초 후)으로 잇습니다. 카드의 CPU·메모리는 이 프로세스와 자식 전체의 합입니다. omp 안에서 `/new`로 만든 세션이나 id 없이 이어 쓴 세션은 소유 프로세스를 찾지 못해 공유 프로세스 합계만 보이고, 그 omp 프로세스는 처음 시작한 세션 카드에 계속 잡힙니다.

## 보안

이 서버는 셸 명령 실행과 에이전트 프롬프트 전송을 그대로 받습니다. 방어는 네 가지입니다.

- `127.0.0.1`에만 바인드합니다. 다른 PC에서는 접속할 수 없습니다.
- 모든 요청에서 `Host`가 `127.0.0.1:<포트>` 또는 `localhost:<포트>`인지 확인합니다(DNS rebinding 차단).
- `/api/*`는 `Origin`·`Sec-Fetch-Site`가 같은 출처일 때만 받고, POST는 `Content-Type: application/json`만 받습니다. 브라우저에서 연 다른 사이트가 이 서버로 명령을 보낼 수 없습니다.
- `/api/engineering/*`는 데스크톱 앱이 만든 토큰 헤더가 있어야 합니다. 웹 모드에서는 403입니다.

이 PC에 로그인한 다른 프로그램은 막지 못합니다. 포트를 외부에 열거나 프록시 뒤에 두지 마세요.

DB 연결 프로필은 브라우저 `localStorage`(`omp-map-dbprofiles`)에 유형·host·port·database·user·path 만 저장하고 비밀번호는 저장하지 않습니다. 비밀번호는 `/api/db/query` 요청 본문으로만 오가며, MySQL·MariaDB 에서는 프로세스 목록에 남지 않도록 `MYSQL_PWD` 환경변수로, Oracle 은 `sqlplus` 인자로 넘깁니다.
