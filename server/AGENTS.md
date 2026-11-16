# server/

<!-- AUTO:START -->
<!-- AUTO:END -->
<!-- MANUAL:START -->
<!-- MANUAL:END -->
<!-- AUTO:START -->
**부모**: [루트](../AGENTS.md)  
**하위 AGENTS.md**: 없음

## 경계와 흐름
- 루트 `server.js`가 `127.0.0.1`에 HTTP 서버를 열고 수집·방송 주기를 시작한다. 서버 코드를 바꾸면 프로세스를 재시작해야 한다.
- `config.js`는 세션 경로·포트·시간 범위와 응답 크기 상수를 소유한다. `tail.js`는 세션 JSONL을 오프셋과 미완성 줄로 증분 수집하고, `ingest.js`는 이벤트를 파일별 상태로 누적한다. `snapshot.js`는 이를 세션·노드로 묶고 메시지 예산을 적용한다.
- `server.js`는 세션 파일을 2초마다 스캔하고 파일 감시 이벤트도 사용한다. `proc.js`는 4초마다 프로세스를 갱신한다. `active.js`, `ext-live.js`도 시작된다.
- `routes.js`가 공통 가드 뒤 라우트 표와 `ui/` 정적 파일을 분기한다. `routes-ops.js`는 셸·잡·프로세스·인프라·DB, `routes-chat.js`는 세션·프롬프트·모델, `routes-context.js`는 맥락 API를 맡는다.
- `sse.js`는 `/api/events` 구독자에 스냅샷과 `{chat: ...}`, `{live: ...}` 이벤트를 방송한다. 접속 시 `routes.js`가 스냅샷과 최근 출력을 재생한다. `live.js`는 RPC 프레임을 변환하고, `ext-live.js`는 확장 JSONL을 따로 읽되 맵 RPC 세션과 중복하지 않는다.

## 변경 시 주의
- `http.js`의 Host·Origin·Sec-Fetch-Site·JSON Content-Type 검사와 본문 크기 제한을 유지한다. 비 API GET은 Host만 검사하므로 경계 변경 시 예외를 함께 살핀다.
- 운영 API는 실제 명령 실행, 프로세스 종료, 인프라 조작 및 DB 질의를 수행한다. 로컬 바인딩과 요청 가드를 보안 경계로 취급하고 외부 노출을 피한다.
- `routes-localfs.js`는 서버 시작마다 만든 토큰으로 로컬 파일을 제공하며 CSP sandbox를 적용한다. 토큰·경로 검증·sandbox를 우회하거나 완화하지 않는다.
- JSONL의 부분 줄, 파일 크기 감소, RPC와 확장 이벤트 중복, SSE 재접속 재생 및 스냅샷 변경 감지에 영향을 주는 변경은 각 경계를 함께 살핀다. `snapshot.js`의 응답 형식은 UI와 SSE 양쪽 계약이다.
<!-- AUTO:END -->
