# server/

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
## 코드 편집기 API
- `routes-editor.js`가 `POST /api/editor/read|write|definition|diagnostics`와 `GET /api/editor/status`를 맡는다. 절대 경로만 받고, 읽기/쓰기 상한은 2MB(본문은 3MB), 디렉터리·바이너리는 거부한다. 저장은 받은 `mtime` 이 현재와 같을 때만 하고 다르면 409다(`mtime:null` 은 강제 저장).
- `lsp.js`는 파일의 프로젝트 루트(pyproject/setup.py/pyrightconfig/.git, 없으면 파일 폴더)마다 `pyright-langserver --stdio`를 하나 띄우고 Content-Length JSON-RPC로 initialize/didOpen/didChange/definition/publishDiagnostics를 다룬다. 5분 유휴 시 종료하고 프로세스 종료 시 정리한다. `lsp-client.js`는 프레이밍·요청/알림만, `lsp-find.js`는 실행 파일 탐색과 루트 판별만 맡는다.
- pyright가 없으면 `status` 가 `{pyright:false}` 를 주고 편집·저장은 그대로 된다. 진단 대기는 15초, 정의 요청은 20초에서 끝난다. pyright는 URI를 `file:///c%3A/...` 로 정규화하므로 진단 키는 `keyOf` 로 맞춰 비교한다.
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [루트](../AGENTS.md)  
**하위 AGENTS.md**: 없음

## 경계와 흐름
- 루트 `server.js`가 `127.0.0.1`에 HTTP 서버를 열고 수집·방송 주기를 시작한다. 서버 코드를 바꾸면 프로세스를 재시작해야 한다.
- `config.js`는 세션 경로·포트·시간 범위와 응답 크기 상수를 소유한다. `tail.js`는 세션 JSONL을 오프셋과 미완성 줄로 증분 수집하고, `ingest.js`는 이벤트를 파일별 상태로 누적한다. `snapshot.js`는 이를 세션·노드로 묶고 메시지 예산을 적용한다. 활동 요약은 `activity.js`(순수: 줄마다 툴 호출·결과·발화를 누적 — 읽기·수정 +/−·명령 ✓/✗·최근 활동 10개·편집 조각, 상한 있음)가 `ingest.js`·`harness/claude-msg.js`에서 증분으로 쌓고, `activity-tree.js`가 `finishSession`에서 부모가 준 지시(목표)·받은 결과·자식 id 를 이어 노드의 `act`로 싣는다(맵 에이전트 노드의 계약).
- `server.js`는 세션 파일을 2초마다 스캔하고 파일 감시 이벤트도 사용한다. `proc.js`는 4초마다 프로세스를 갱신한다. `active.js`, `ext-live.js`도 시작된다.
- `routes.js`가 공통 가드 뒤 라우트 표와 `ui/` 정적 파일을 분기한다. `routes-ops.js`는 셸·잡·프로세스·인프라·DB, `routes-chat.js`는 세션·프롬프트·모델, `routes-context.js`는 맥락 API를 맡는다.
- `sse.js`는 `/api/events` 구독자에 스냅샷과 `{chat: ...}`, `{live: ...}` 이벤트를 방송한다. 접속 시 `routes.js`가 스냅샷과 최근 출력을 재생한다. `live.js`는 RPC 프레임을 변환하고, `ext-live.js`는 확장 JSONL을 따로 읽되 맵 RPC 세션과 중복하지 않는다.
- 하네스 경계는 `harness.js`(omp·claude 기능 플래그와 경로 판별), `harness/claude.js`(메인 기록 읽기), `harness/claude-msg.js`(Claude 레코드 → omp 메시지 모양 정규화), `harness/claude-sub.js`(subagents 기록·meta), `harness/claude-merge.js`(스냅샷 병합), `harness/claude-run.js`(claude CLI 실행·ask), `harness/claude-ops.js`(압축·비우기), `harness/claude-model.js`(카드별 모델), `harness/switch.js`(요약 이어받기 하네스 전환)다. 요약은 `summary.js`, omp lease 확인은 `omp-lease.js`. 세션 제목·첫 지시(`title`·`firstUser`)는 `session-title.js`(순수)가 하네스 머리말(`[OpenClaw: …]`·`[System …]`·시각 표시)·시스템 태그 블록·`⟦…⟧` 메타 문단·글꼴에 없는 글리프를 걷은 첫 의미 있는 사용자 줄로 정한다(없으면 다음 사용자 메시지). 스냅샷 노드의 `harness` 필드가 UI 계약이고, 세션 키는 `claude|` 접두사로 omp 키와 겹치지 않는다. 전환 뒤에도 카드 id 는 계보로 유지되며, 하네스 판정은 항상 `lineage.resolve` 한 실제 파일 기준이다. `~/.claude` 파일은 읽기 전용이며, 새 하네스는 이 경계에 어댑터 하나로 더한다.

## 변경 시 주의
- `http.js`의 Host·Origin·Sec-Fetch-Site·JSON Content-Type 검사와 본문 크기 제한을 유지한다. 비 API GET은 Host만 검사하므로 경계 변경 시 예외를 함께 살핀다.
- 운영 API는 실제 명령 실행, 프로세스 종료, 인프라 조작 및 DB 질의를 수행한다. 로컬 바인딩과 요청 가드를 보안 경계로 취급하고 외부 노출을 피한다.
- `routes-localfs.js`는 서버 시작마다 만든 토큰으로 로컬 파일을 제공하며 CSP sandbox를 적용한다. 토큰·경로 검증·sandbox를 우회하거나 완화하지 않는다.
- JSONL의 부분 줄, 파일 크기 감소, RPC와 확장 이벤트 중복, SSE 재접속 재생 및 스냅샷 변경 감지에 영향을 주는 변경은 각 경계를 함께 살핀다. `snapshot.js`의 응답 형식은 UI와 SSE 양쪽 계약이다.
<!-- AUTO:END -->
