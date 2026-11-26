# 하네스: omp와 Claude Code

세션을 만든 실행기(하네스)별 동작과, 터미널에서 연 세션을 실시간으로 보여 주는 확장을 설명합니다. Engineering의 하네스(역할·작업 지시 묶음)와는 다른 개념이므로 용어는 [용어집](../glossary.md)을 보세요.

## 하네스 선택: omp · Claude Code

카드에는 그 세션을 만든 하네스 칩(`omp` / `Claude`)이 붙습니다. 새 세션 창의 **하네스**에서 고르고, 마지막 선택은 브라우저에 기억됩니다.

- **omp**(기본): 지금까지와 같습니다. `omp --mode rpc-ui --append-system-prompt server/main-card-prompt.md`로 띄우고 압축·비우기·모델 변경·ask를 모두 씁니다. `main-card-prompt.md`는 메인 카드 세션이 작업을 `task` 서브에이전트에 넘기고 `wait` 없이 턴을 바로 끝내 사용자 메시지를 계속 받게 하는 지시입니다. omp는 이 지시를 서브에이전트에 넘기지 않습니다. 이 플래그가 `~/.omp/agent/APPEND_SYSTEM.md`를 대신하므로, 그 파일을 만들면 내용을 `main-card-prompt.md`에 합칩니다.
- **Claude Code**: `~/.claude/projects/<슬러그>/<sessionId>.jsonl`을 **읽기 전용**으로 읽어 카드로 그립니다(제목·대화·cwd·토큰·비용·툴). 서브에이전트 기록(`<sessionId>/subagents/agent-*`)도 메인 아래 카드로 그려 실행 중이면 자동 도킹·완료 시 자동 닫힘합니다.
- 프롬프트는 `claude -p --output-format stream-json --include-partial-messages`로 보내고, 이어가기는 `--resume <sessionId>`, 취소는 프로세스 종료입니다. 모델 변경은 다음 실행에 `--model <별칭>`으로 넘깁니다(카드별 저장). 첨부 이미지는 stream-json 입력의 이미지 블록으로, 일반 파일은 임시 경로에 저장해 `@경로`로 참조합니다.
- **비우기**는 계보(lineage)에 다음 세션 파일을 적어 카드 id·자리·메모를 유지한 채 빈 세션으로 잇습니다. **압축**은 `/compact [지시문]`을 프롬프트로 보냅니다(Claude Code `-p` 모드의 슬래시 명령 지원 여부는 [미확인]). **ask**는 스트림의 `AskUserQuestion` tool_use를 기존 질문 카드로 띄우고, 고른 답을 다음 프롬프트로 보냅니다.
- Claude Code에는 없는 기능: 컨텍스트 구성 조회(대화·툴 스키마·시스템 토큰 분해). 이 블록은 Claude 카드 메뉴에 나오지 않습니다.
- **하네스 전환**: 카드 우클릭 메뉴에서 반대 하네스로 옮길 수 있습니다. 원래 세션의 요약(요약 모델 실패 시 대화 발췌)을 넘겨 같은 cwd 에 새 세션을 시작하고, 계보(lineage)로 카드 id·별칭·메모·위치·블록을 그대로 유지합니다. 원래 기록은 지도에서 숨고(파일은 남음), 원래 omp rpc 는 자원을 정리합니다. 도는 턴이 있으면 전환하지 않습니다. 양방향 반복 전환할 수 있습니다.
- Claude Code 실행에는 `claude` CLI가 PATH에 있어야 합니다. 없으면 카드에서 "claude 실행 실패"로 알립니다.


## 터미널 세션 실시간 표시(확장)

TUI에서 연 omp 세션의 기록 파일은 0.3초 안에 읽히지만, 진행 중인 bash 출력은 툴이 끝날 때 한 번에 기록에 남습니다. 그래서 omp 확장 `extension/live-map.ts`가 세션 안에서 툴 진행 프레임(백그라운드 잡 포함)과 에이전트 글을 직접 받아 `~/.omp/live-map/<세션>.jsonl`로 흘리고, 서버의 `server/ext-live.js`가 그 파일을 tail 해 기존 live 이벤트로 방송합니다.

설치(omp가 `~/.omp/agent/extensions/`를 자동으로 읽으므로 설정 파일은 건드리지 않습니다):

```bash
node extension/install.js
```

적용은 **새로 연 세션부터**입니다. 이미 떠 있는 TUI 세션은 다시 시작해야 확장이 붙습니다. 서버도 `server/ext-live.js`를 읽도록 재시작해야 합니다.

- 기록은 툴 호출별로 늘어난 출력의 끝 8000자, 파일 하나가 2MB를 넘으면 새로 시작합니다. 확장은 TUI와 같은 프로세스에서 도므로 처리를 모두 try/catch로 감싸고 디스크 쓰기만 비동기 큐로 묶습니다.
- 맵이 직접 띄운 rpc 세션은 프레임이 원천이므로 확장 기록은 건너뜁니다(중복 표시 없음). 서버를 새로 켜도 최근 10분 활동은 새로 붙은 화면에 되살아납니다.
