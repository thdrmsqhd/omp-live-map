# ADR-0001: 맵 세션은 세션마다 상주하는 `omp --mode rpc-ui` 프로세스로 실행한다

**Date:** 2026-11-13
**Status:** Accepted (by grill-with-docs session)
**Source:** grill-with-docs session on 2026-11-13

## Context

맵 하나만으로 업무를 진행하려고 한다. omp TUI를 띄우지 않고 맵에서 새 세션을 열어 대화를 시작하고, 서브에이전트가 하는 일을 글자 단위로 실시간으로 본다. 실행 엔진은 omp 바이너리를 그대로 쓴다.

지금 `server/prompt.js`는 프롬프트마다 `omp -p -r <세션 파일> --mode=json`을 띄우고 180초가 지나면 끝낸다. 이 방식에는 새 세션 생성이 없고, 서브에이전트는 기록 파일 tail(2초 주기, fs.watch 300ms)로만 보여서 메시지가 완성된 뒤에야 뜬다. 에이전트가 `ask` 툴을 호출하면 UI가 없어 그 턴이 중단된다.

omp v18.20.0 `rpc.md` 기준으로 `--mode rpc`/`rpc-ui`는 `new_session`, `prompt`, `steer`, `follow_up`, `abort`, `cancel_subagent`, `steer_subagent`, `get_session_lease`를 받고, `set_subagent_subscription: "events"`를 켜면 서브에이전트 이벤트를 내보낸다.

## Decision

- 맵 세션 하나에 `omp --mode rpc-ui` 자식 프로세스 하나를 둔다. 사용자가 세션 종료(stop)를 누를 때까지 유지한다. 유휴 자동 종료는 하지 않는다.
- 기존 `omp -p -r` 전송 경로는 없앤다. 빈 세션에 프롬프트를 보내면 그 세션에 rpc 프로세스가 붙어 맵 세션이 된다.
- 새 세션은 작업 폴더(cwd)와 첫 프롬프트를 받고, 파일·이미지를 첨부할 수 있다. 모델·승인 방식·비용 상한은 omp 설정을 따른다.
- `ask`는 `rpc-ui`의 `select`·`editor` 요청으로 받아 맵 채팅 블록의 대화상자로 답한다. 답을 기다리는 카드는 맵에서 눈에 띄게 표시한다.
- 서브에이전트 구독은 맵 세션에서 항상 `events`로 둔다.
- TUI가 잡고 있는 세션(TUI 세션)에는 프롬프트를 보내지 않는다. 소유 여부는 `omp session lease --json -- <id>...`로 조회한다. 카드는 읽기 전용으로 두고 "TUI 사용 중"을 표시한다.
- 맵 서버가 재시작되면 맵 세션은 끊긴 채로 둔다. 카드에 "중단됨"을 표시하고 사용자가 누르면 `omp --restore`로 이어 간다.
- 맵이 강제하는 상한(동시 세션 수, 비용, 시간)은 두지 않는다. 사용자가 HOST 카드의 RAM과 카드의 비용 표시를 보고 직접 멈춘다.

## Consequences

- Good: 새 세션 생성, 턴 도중 추가 지시(steer), 취소, 서브에이전트 취소·추가 지시, `ask` 응답이 한 프로세스에서 된다. rpc는 버전이 붙은 프로토콜이라 `--mode=json` 출력보다 omp 갱신에 덜 깨진다.
- Good: 2026-11-13 확인. `get_state`는 첫 프롬프트 전에도 `sessionFile`·`sessionId`를 돌려준다(모델 호출 없음, 기동 약 1.6초). `omp session lease`는 id 여러 개를 한 번에 조회한다.
- Bad: 맵 세션마다 omp 프로세스가 계속 뜬다. 이 PC 측정값은 본체 122~575MB에 자식 평균 100MB이고, RAM 16GB 중 여유는 4.8GB였다.
- Bad: 맵 서버가 내려가면 맵 세션 전부가 진행 중인 턴과 서브에이전트째로 끝난다. 맵 세션 안의 에이전트가 이 저장소의 `server/`를 고치고 서버를 재시작하면 자기 자신도 끊는다.
- Bad: `tools.approvalMode = yolo`, `ask.timeout = 0`, 상한 없음이 겹친다. 턴은 확인 없이 파일 쓰기·명령 실행을 하며 사용자가 멈출 때까지 진행하고, 답하지 않은 `ask`는 세션을 계속 붙잡는다. 사용자가 이 위험을 받아들였다.
- Bad: `subagent_event`의 `message_update`는 증분이 아니라 전체 메시지다. 서브에이전트 여러 개가 길게 쓰면 stdout 양이 글자 수의 제곱으로 는다. 맵 서버가 증분으로 바꿔 SSE로 보내야 한다.
- Bad: 맵 세션을 TUI로 이어 쓰려면 먼저 세션 종료(stop)를 해야 한다.
- Bad: 의존성 0 규칙 때문에 rpc 클라이언트(JSONL 프레임, 요청 id 대조, UI 요청 응답)를 직접 쓴다. 파일당 200줄 미만 규칙에 맞춰 모듈을 나눠야 한다.
- Reversibility: hard. `prompt.js`를 rpc 클라이언트로 다시 쓰고, 채팅 viewmodel 이벤트와 `ask` 대화상자 화면이 이 결정에 묶인다. 되돌리는 데 며칠이 든다. 구독 수준(`events` → 큰 카드가 열렸을 때만)과 상한 추가는 쉽게 바꿀 수 있다.

## Alternatives considered

- `omp -p` 유지 + 새 세션만 추가: 서브에이전트 글자 단위 스트리밍과 `ask` 응답이 안 된다. 완료 기준을 낮춰야 해서 제외.
- 상주 rpc + 유휴 자동 종료: 메모리는 줄지만 사용자가 "닫을 때까지 유지"를 골랐다.
- `omp acp`: 같은 상주 방식이지만 이번 세션에서 검토하지 않았다.
- 맵 서버와 분리된 상주 프로세스가 세션을 소유: 서버 재시작에도 살지만 "재시작 뒤에도 실행 유지"를 요구하지 않아 제외.
- TUI 세션 강제 인수, fork 후 진행: 원본 세션을 건드리거나 세션이 갈라져서 제외.
- `ask` 끄기, `rpc`로 띄워 `ask` 실패 방치: grill 계열 스킬이 맵 세션에서 동작하지 않아 제외.
