# 맵 세션 호스트 구현 계획

## 목표
- [ ] 맵이 세션을 직접 띄우고, 메인·서브에이전트·잡이 지금 하는 일을 실시간으로 보며 조종한다. 이 계획은 순서 1·2번까지 다룬다. 3~6번은 목록만 적는다.

## 0단계: 실험 (코드 수정 전)
- [x] 실험 1: `omp --mode rpc-ui`가 내보내는 이벤트 받아 적기. 완료(2026-11-13). 결과는 `%TEMP%/omp-rpc-exp/summary-full.json`.
- [x] 실험 2: 턴 도중 강제 종료한 세션의 기록 파일 끝 모양. 완료(2026-11-13).
- [ ] 실험 3: TUI가 잡은 세션에 `-r`로 rpc를 붙이면 omp가 거부하는지. 미착수. 사용자의 실제 세션을 건드리므로 임시 세션 폴더에서 한다.
- [ ] 실험 결과에 따라 바뀔 수 있는 점: 이벤트 필드 이름, "중단됨" 판정 방법.

### 실험 결과 (원본: `%TEMP%/omp-rpc-exp/frames-full.jsonl`, `summary-full.json`, `frames-kill.jsonl`)
- 글: `message_update`의 `text_delta`로 글자 단위로 온다. 생각은 `thinking_start/delta/end`, 툴 인자는 `toolcall_start/delta/end`.
- 툴 실행: `tool_execution_start` → `tool_execution_update`(여러 번) → `tool_execution_end`. 출력 글은 `partialResult.content[0].text`에 실리고, 매번 처음부터 전체가 다시 온다. 서버에서 늘어난 부분만 뽑아야 한다.
- 에이전트가 띄운 잡: 툴이 "Backgrounded as job bg_N"으로 반환한 뒤에도 같은 `toolCallId`의 `tool_execution_update`로 출력이 계속 온다. 같은 줄이 2번씩 왔다(30~70ms 차이). 중복을 걸러야 한다. 끝나면 `message_start`(role `custom`, customType `async-result`)가 온다.
- 서브에이전트: `subagent_event`의 `payload.event` 안에 메인과 같은 이벤트(`message_update`, `tool_execution_*`, `turn_*`)가 들어 있다. `subagent_lifecycle`의 `payload`에 `id`, `agent`, `status`, `sessionFile`, `parentToolCallId`가 있어 카드(기록 파일 경로)와 이을 수 있다. `subagent_progress`도 온다.
- `extension_ui_request`는 `setWidget`만 3번 왔다. 1단계에서는 무시한다.
- `get_state` 응답의 `data`에 `sessionFile`, `sessionId`, `model{id, name, provider, contextWindow}`가 있다.
- 끊긴 세션: 턴 도중 강제 종료하면 기록 파일이 `tool_execution_start`(custom)로 끝나고 결과 레코드가 없다. "중단됨" 판정은 "마지막 툴 시작에 짝이 되는 결과가 없고, 그 세션을 잡은 omp 프로세스가 없다"로 한다.

## 1단계: 맵이 세션을 직접 띄운다

### 서버
- [ ] 새 파일 `server/rpc.js`: omp 자식 프로세스 1개와의 줄 단위 JSON 주고받기, 요청 id 대조, `ready` 대기, 종료 정리. 상태를 갖지 않는 함수 모음으로 작성한다.
- [ ] 새 파일 `server/sessions.js`: 맵 세션 등록부(세션 파일 경로 → rpc 프로세스)를 소유한다. 열기, 이어 붙기(`-r`), 종료, 지시, 추가 지시, 멈춤을 처리한다. 붙기 전에 `omp session lease --json -- <id>`로 TUI 소유 여부를 조회한다.
- [ ] `server/prompt.js` 삭제:
  - 기존 `runPrompt(st, text)`(`server/prompt.js:19-67`): `omp -p -r <file> --mode=json` 자식 spawn 및 JSON 이벤트를 SSE로 중계. 유일 호출자는 `server/routes-chat.js:15`(`await runPrompt(st, text)`).
  - 기존 `cancelPrompt(node)`(`server/prompt.js:70-76`): `run.cancelled=true` 후 `run.stop(130)`. 유일 호출자는 `server/routes-chat.js:17`(`POST /api/prompt/cancel`).
  - 기존 `pushChat(payload)`(`server/sse.js:17-20`): `data: {"chat":...}` 프레임 broadcast. 호출자는 `server/prompt.js:23,36,56,59`(`req`/`done`/`delta`). UI는 이 세 함수를 직접 부르지 않고 HTTP와 SSE로만 접촉한다.
- [ ] 라우트(`server/routes-chat.js`):
  - 라우트 키 형식과 가드: `server/routes.js:11-24`의 `"METHOD /api/path"` 형태와 `server/routes.js:50`의 `ROUTES[req.method+" "+path] || ROUTES["* "+path]` 조회 방식을 따른다(`server/routes-ops.js:13`~, `server/routes-chat.js:10,17,18`). `server/http.js:24-33`의 `guardStatus(req)`(Host·Origin·Sec-Fetch-Site·Content-Type 검사, 403·415)와 `server/http.js:43-74`의 `withJson(req, res, handler)`(1MB 상한 본문 파싱) 가드를 거친다.
  - `POST /api/session/new {cwd, text}`: 새 맵 세션을 띄우고 첫 지시를 보낸다.
  - `POST /api/session/stop {node}`: 맵 세션의 rpc 프로세스를 정상 종료한다.
  - `POST /api/prompt {node, text}`: 세션이 도는 중이면 추가 지시(steer)로 보낸다.
  - `POST /api/prompt/cancel {node}`: 현재 진행 중인 턴을 멈춘다(abort).
- [ ] SSE(`server/sse.js`): 기존 `chat` 이벤트(`req`/`delta`/`done`)를 유지해 1단계에서는 UI 변경을 줄인다.
- [ ] 스냅샷: 노드에 소유 상태(`owner`: map | tui | none)를 더한다. 기록 파일이 아직 없는 새 세션은 임시 노드로 넣는다.

### 화면
- [ ] 빈 바탕 메뉴에 "새 세션": `ui/js/view/menu.js:101` `openStageMenu` 위치에 메뉴 항목을 추가하고, 작업 폴더와 첫 지시를 받는 새 세션 창을 연결한다(`ui/js/view/menu.js:6` `showMenu`, `ui/js/view/menu.js:111` stage contextmenu).
- [ ] 카드 메뉴에 "세션 종료": `ui/js/view/menu.js:79` `openCardMenu`에 메뉴 항목을 추가하고, 기존 "세션 프로세스 종료"는 "프로세스 정리"로 이름을 바꾼다.
- [ ] 대화 블록:
  - TUI가 잡은 세션은 입력을 막고 "TUI 사용 중"을 표시한다.
  - 세션이 도는 중에도 보내기 버튼을 활성화해 추가 지시(steer)를 보낼 수 있게 한다.
  - 관련 화면 및 뷰모델 지점:
    - `ui/js/viewmodel/chat.js:27` `sendChat`: `postJSON("/api/prompt", {node, text})`, busy·스트림·오류 상태 관리.
    - `ui/js/viewmodel/chat.js:53` `cancelChat`: `postJSON("/api/prompt/cancel", {node})`.
    - `ui/js/app.js:41-42` SSE 리스너: `data.chat` 분기 시 `handleChatEvent(data.chat)`.
    - `ui/js/viewmodel/chat.js:93-113` `handleChatEvent(c)`: `req`/`delta`/`done` 분기.
    - `ui/js/viewmodel/map.js:159-162` `chatState(id)`: `{draft, summary, busy, log, stream}` 관리.
    - `ui/js/view/block-chat.js:17` `chatListHTML`, `:31` `chatBlock`, `:67` `paintChat`, `:101` `mountChat`, `:133` `registerBlock({type:"chat", ...})`.
    - 블록 등록 및 배치: `ui/js/view/blocks.js:14` `registerBlock`, `:20` `BLOCK_DEFAULTS`, `:32` `cardBlockTypes`, `:70` `blockSig`. 전체 스크립트 로드 순서는 `ui/index.html:56-68`을 따른다.

### 확인
- [ ] 가짜 omp(rpc 흉내)를 PATH 앞에 두고 포트 7806에서 동작을 확인한다: 새 세션 열기, 지시, 추가 지시, 멈춤, 세션 종료가 화면에서 되는지 본다. 실행 전 `where omp`로 가짜 바이너리가 먼저 잡히는지 확인한다.
- [ ] 마지막에 실제 omp로 1번 확인한다.
- [ ] `node --check` 전체 통과와 파일당 200줄 미만 규칙 준수를 확인한다.

## 2단계: 실시간 흐름

### 서버
- [ ] 새 파일 `server/live.js`: rpc 이벤트(글, 생각, 툴 시작·중간·끝, 서브에이전트 이벤트)를 카드별 SSE 이벤트로 내보낸다. 서브에이전트 이벤트는 전체 메시지가 매번 오므로 서버에서 늘어난 부분만 뽑는다.
- [ ] 기록에서 더 읽기: 생각, 툴 인자, 툴 결과, 명령 출력. `server/ingest.js`는 현재 191줄로 200줄 한계치에 근접해 있으므로 새 파일 `server/steps.js`로 분리한다. 툴 결과 전체를 메모리에 둘지 카드를 열 때 기록에서 읽을지는 미정으로 둔다.

### 화면
- [ ] 새 블록 `ui/js/view/block-live.js`(`registerBlock`), viewmodel `ui/js/viewmodel/live.js`:
  - 항목 종류: 생각, 툴 호출과 인자, 툴 결과, 명령과 출력, 고친 파일, 잡 띄움, 쓰는 중인 글.
  - 메인 에이전트와 서브에이전트 카드에 공통으로 적용한다.
  - `ui/index.html`에 classic script 로드 순서대로 등록한다.
- [ ] 모델과 단가 표시:
  - 모델 이름: 이미 `server/ingest.js:84` `st.model = m.model`, `:149` `model_change` 반영 → `server/snapshot.js:32` `node.model`, `:43` `ctxWindow`에 반영되어 있으며, 카드 표시는 `ui/js/view/card-session.js:28`, `ui/js/view/card-compact.js:65`(`ui/js/core/format.js:19` `modelShort`)에서 처리한다.
  - 단가 출처: 저장소 및 `~/.omp/agent/models.yml` 어디에도 가격 필드가 없다(models.yml은 id/contextWindow/maxTokens/headers만 포함하며 `server/models.js:96-136`도 contextWindow만 읽는다). 대안 근거로 `~/.omp/agent/models.db`의 `model_cache.models[]` 객체에 `cost:{input, output, cacheRead, cacheWrite}`(USD/1M 추정)가 존재하나 `zen-go` 행은 DB에 없다. 턴별 실측 비용은 `server/ingest.js:93,151`의 `usage.cost.total`로 이미 `cost`에 누적 중이다. 따라서 단가 데이터 출처는 "미정"으로 표시한다.

### 확인
- [ ] 가짜 omp가 이벤트를 흘리게 해서 카드에 시간순으로 나오는지, 입력 포커스와 스크롤이 끊기지 않는지 본다.

## 4단계: 잡 카드와 출력 스트리밍 (완료 2026-11-13)
- [x] 데이터 원천 실측:
  - TUI 세션: 기록(`~/.omp/agent/sessions/<세션>/<Agent>.jsonl`)에는 툴 시작(`tool_execution_start`: toolCallId·toolName·args·startedAt)만 남고, 툴 결과는 끝날 때 한 줄로 붙는다. 실행 중 출력은 디스크 어디에도 없다(실측: `<세션>/<n>.bash.log`는 호출 시작에 만들어지지만 내용은 툴이 끝나야 채워지고, `~/.omp/logs/omp.*.log`에도 잡 출력이 없다). 잡 출력은 끝난 뒤 `custom_message`/`async-result` 한 덩어리로 온다.
  - 맵 rpc 세션: 같은 toolCallId의 `tool_execution_update`로 실행 중에도 계속 온다(같은 줄 중복은 서버에서 걸러진다).
- [x] 서버: `server/jobs.js`(도는 툴·잡 상태·꼬리 줄), `server/active.js`(0.8초 주기로 기록 이벤트를 SSE `live`로 방송, 맵 rpc 세션은 `tool_job`만 통과), `server/snapshot.js`의 `node.active`, `/api/events` 접속 시 도는 툴·출력 되살리기(`server/routes.js`, `server/live.js`의 `outsFor`).
- [x] 화면: 스테이지 잡 카드(`ui/js/view/job-card.js`)에 명령·상태·경과·마지막 줄, 눌러 펼치면 출력이 끝쪽을 따라가고 위로 올리면 멈춘다. 작은 카드에도 "지금 하는 일" 한 줄(`card-compact.js` `nowLine`).
- [x] 중복 제거: 잡 출력은 잡 카드에만. live 블록은 `잡 bg_N 띄움` 한 줄, bg 블록은 기본 블록 목록에서 뺐다(블록 메뉴로는 추가 가능).
- 남은 한계: TUI 세션의 실행 중 출력은 원천이 없어 볼 수 없다(끝난 뒤 꼬리만). 잡 중지는 rpc 명령이 `abort`(턴 취소)뿐이라 구현하지 않았다.

## 5단계: 질문에 답하기 (완료 2026-11-16)
- [x] 서버: `server/ui-requests.js`가 세션 노드별 대기 요청(ask·select·confirm·input·editor)을 소유한다. `server/sessions.js`의 `start()`가 `bind(s)`로 잇고, 세션 ready 직후 rpc 명령 `{type:"set_ask_dialog", enabled:true}`를 보낸다(이 명령 없이는 ask가 오지 않는다).
  - `cancel`(targetId)은 그 질문 카드만 닫고, `notify`는 활동 한 줄(`live` 이벤트 `kind:"notify"`)로만 보이며, `setStatus`·`setWidget`·`setTitle`·`openUrl` 등은 무시한다.
  - 답은 stdin `{type:"extension_ui_response", id, …}`로 보낸다(`server/rpc.js` `sendRaw`). method별 화이트리스트(ask=`answers[{id, selectedOptions, customInput?}]`, select·input·editor=`value`, confirm=`confirmed`, 취소=`cancelled`)만 통과시킨다.
- [x] 방송·복원: `server/sse.js` `pushAsk`가 `{ask:{node, kind:"add"|"del", request|id}}`를 보내고, `/api/events` 접속 시 `routes.js`가 `asksFor(node)`로 대기 질문을 되살린다. 답 라우트는 `POST /api/chat/answer {node, id, response}`이며 없는 id·이미 해소된 id는 409. 턴 종료(`agent_end`)·프로세스 종료·세션 rekey 시 대기 질문을 닫는다.
- [x] 화면: `ui/js/viewmodel/chat-ask.js`(대기 상태·답 조립·전송)와 `ui/js/view/chat-ask.js`(카드 렌더·이벤트 배선)를 추가하고 `ui/index.html`의 classic script 순서(core→model→viewmodel→view→app)에 넣었다.
  - 대화 블록 `.casks`에 카드가 뜬다: ask(여러 문항, 라디오/체크박스, 추천 표시, 자유 입력), select, confirm, input(secret은 password), editor(prefill).
  - 다시 그릴 때(`paintChaAsk`) 질문 구성이 그대로면 DOM을 건드리지 않고, 입력값은 상태에 있어 스트리밍 중에도 포커스·글자가 유지된다. 스크롤은 `overflow-anchor: none`과 scrollTop 복원으로 지킨다.
  - 큰 카드·작은 카드 헤더에 "답 대기" 배지(`askBadge`).
- [x] 검증(가짜 omp, 포트 7808 — 7806은 다른 프로세스가 점유 중): 실제 포인터 클릭으로 카드에 답했고 `%TEMP%/asktest/responses.log`의 응답이 계약과 일치했다. 새로고침 후 복원, ✕ 취소(`cancelled:true`), 해소된 id 409, 스트리밍 중 입력 포커스 유지를 확인했다.
- 남은 한계: `select`의 `selectionMarker:"checkbox"` 답은 `value`가 문자열 하나뿐이라 고른 label을 `", "`로 이어 보낸다(omp 계약 확인 필요). 시한 초과(timeout)는 omp가 recommended로 스스로 처리하며, 화면 카드는 턴이 끝날 때 함께 닫힌다.

## 그다음 (이 계획 밖)
- 3단계: 서브에이전트 개별 멈춤·직접 지시
- 5단계: 질문에 답하기(완료 2026-11-16), 파일 첨부
- 6단계: 전체 합계 줄, 금액 기준

## 위험
- [ ] 맵 서버를 재시작하면 맵 세션이 전부 끊긴다. 개발 중에는 테스트 포트 7806만 재시작한다.
- [ ] 승인 방식이 yolo이고 상한이 없다.
- [ ] git 저장소가 아니다. 수정 전 백업을 `%TEMP%`에 남긴다.
