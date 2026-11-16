# tests/fake-omp

1. `node tests/fake-omp/launch.js 7808` — PATH 앞에 `bin/omp.exe`(node `fake-omp.js`)를 두고 맵을 띄운다. 출력 `omp:` 경로가 이 폴더의 `bin\omp.exe`가 아니면(진짜 omp) 중단한다.
2. `--scenario scenarios/ask-basic.json` 또는 환경변수 `FAKE_OMP_SCENARIO`로 시나리오 지정(기본은 짧은 text_delta 응답). ask는 `set_ask_dialog enabled:true` 뒤에만 나간다.
3. 받은 stdin·보낸 프레임: `tests/fake-omp/fake-omp.log.jsonl`(`FAKE_OMP_LOG`로 변경). 세션 기록: `home/.omp/agent/sessions/--C--fake--/`.
4. 세션 열기 예: `curl -s -X POST http://127.0.0.1:7808/api/session/new -H "Content-Type: application/json" -d '{"cwd":"C:/workspace/omp-live-map","text":"hi"}'`
