# 개발과 검증

**로컬 회귀 테스트**: `node --test`는 2026-11-26에 Node 26.5(Windows)에서 모두 통과했습니다.

**Windows CI**: `main`에 push하면 "V3 Windows verification"(`.github/workflows/v2-phase-0.yml`)이 `node --test`, Git Bash 터미널, AppContainer, SQLite, Electron 수명주기, 브라우저 회귀와 10개 세션 측정, Engineering 데스크톱 UI 순서로 돕니다.

V4 시점의 기록은 [Windows CI #34](https://github.com/thdrmsqhd/omp-live-map/actions/runs/45507478308)의 40건 통과, 테스트용 10개 세션에서 scan → SSE → DOM 반영 지연 P95 29.4ms(허용 기준 1,000ms)입니다. 과거 측정값이며 현재 `main`의 결과가 아닙니다. 실제 에이전트 프로세스의 메모리 절감량과 설치 프로그램은 별도 검증 대상입니다.

로컬에서는 다음 명령으로 회귀 테스트 및 서버 실행을 확인합니다.

```bash
node --test
node tests/verification/browser.cjs # Playwright 및 Monaco 테스트 의존성 설치 필요
node tests/verification/engineering-desktop.cjs # Electron·Playwright 필요(CI 설치 방법은 워크플로의 "Prepare Electron and Chromium" 단계)
```

추가 구문 검사:

```bash
for f in server.js server/*.js ui/js/*.js ui/js/*/*.js; do node --check "$f"; done
wc -l server.js server/*.js ui/js/*.js ui/js/*/*.js | sort -rn | head   # 200줄 미만
node server.js --port 7806      # 운영 포트와 다른 포트로 띄워 화면에서 확인
```

프롬프트 전송을 실제 비용 없이 확인하려면, JSON 줄을 출력하는 가짜 `omp.exe`를 PATH 맨 앞에 두고 테스트 서버를 띄웁니다. 테스트용 가짜 하네스는 `tests/fake-omp`, `tests/fake-claude`에 있습니다.

## README 스크린샷 다시 만들기

README와 문서의 화면은 실제 앱을 데모 데이터로 실행해 캡처합니다. 개인 경로가 화면에 남지 않도록 데모 세션·프로젝트는 `C:\omp-demo` 아래에 만들고 끝나면 지웁니다.

```bash
npm install --no-save --package-lock=false playwright@1.56.1 electron@43.8.12 monaco-editor@0.52.2
node tests/verification/readme-screenshots.cjs all   # main | engineering | all
```

- `main`: 가짜 omp·Claude Code 세션 기록을 둔 HOME 으로 서버를 띄워 관제·워크스페이스·Live Map(`docs/media/v8/01~03`)을 찍습니다.
- `engineering`: 같은 HOME 으로 데스크톱 앱(Electron)을 띄워 Engineering 화면과 승인 대기 실행(`11~17`)을 찍습니다. 사용자 데이터 폴더도 데모용으로 따로 둡니다.
- 캡처 대상 화면의 요소 이름이 바뀌면 스크립트의 선택자를 고치세요. 실패한 단계는 `[skip]`으로 표시하고 나머지를 계속 찍습니다.
- CI에서는 실행하지 않습니다. 자원 수치(CPU·RAM)는 캡처한 PC의 값입니다.

## 릴리스

1. `main`의 "V3 Windows verification"(`.github/workflows/v2-phase-0.yml`)이 통과한 커밋을 고릅니다.
2. `release/vX.Y.Z-windows` 브랜치에 `.github/workflows/release-vX.Y.Z-windows.yml`을 추가해 push합니다. 이전 릴리스 워크플로(예: `release-v8.2.2-windows.yml`)를 복사해 버전, 고정할 커밋 SHA, 검증 실행 ID, 릴리스 노트를 바꿉니다.
3. 워크플로는 `desktop/package.json` 버전을 맞춰 설치 파일을 만들고, 호스트 Windows 러너에서 설치·검증·삭제(데이터 보존 확인)를 거칩니다. 고정한 커밋이 아직 `main`의 최신이고 그 커밋의 CI가 성공했을 때만 `OMP-Live-Map-X.Y.Z-Windows-x64-Setup.exe`와 `SHA256SUMS.txt`를 GitHub 릴리스로 게시합니다.
4. 설치 파일에는 코드 서명이 없습니다.