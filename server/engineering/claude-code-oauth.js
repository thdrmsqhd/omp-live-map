"use strict";

// Claude Code 구독(Pro·Max) 로그인으로 격리 런타임의 모델 호출을 인증한다.
// - Claude Code 가 남긴 로그인 파일(~/.claude/.credentials.json 또는 CLAUDE_CONFIG_DIR)의 현재 액세스 토큰을 매 호출 직전에 읽는다.
//   토큰 갱신은 Claude Code 자신이 하며, 이 앱은 갱신 토큰을 쓰지 않는다(만료되면 Claude Code 를 한 번 실행하라고 안내한다).
// - `claude setup-token` 으로 받은 장기 토큰(sk-ant-oat…)은 desktop 의 키 저장소에 넣어 같은 방식으로 쓴다.
// 구독 토큰은 Claude Code 자체 요청(시스템 프롬프트 포함)에만 허용되므로, 컨테이너 안의 공식 Claude Code CLI 호출에만 쓰인다.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const API_VERSION = "2023-06-01";
const TOKEN = /^sk-ant-oat[\w.-]{20,400}$/;
const isOAuthToken = (value) => typeof value === "string" && TOKEN.test(value);

// 브로커가 Bearer 와 API 버전을 고르도록 함수에 버전을 붙인다(Console OAuth 는 버전이 없어 기존 값을 쓴다).
function provider(read, label) {
  return Object.assign(async (signal) => {
    signal?.throwIfAborted();
    return read();
  }, { apiVersion: API_VERSION, label });
}

function claudeCodeLogin({ directory = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), now = Date.now } = {}) {
  const file = path.join(directory, ".credentials.json");
  function read() {
    let oauth;
    try { oauth = JSON.parse(fs.readFileSync(file, "utf8")).claudeAiOauth; } catch {
      throw new Error("Claude Code 로그인 정보를 찾을 수 없습니다. Claude Code에서 /login 으로 로그인해 주세요.");
    }
    if (!oauth || !isOAuthToken(oauth.accessToken)) throw new Error("Claude Code 로그인 정보 형식을 확인할 수 없습니다.");
    if (Array.isArray(oauth.scopes) && !oauth.scopes.includes("user:inference")) {
      throw new Error("Claude Code 로그인에 모델 호출 권한(user:inference)이 없습니다.");
    }
    if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt - now() < 60000) {
      throw new Error("Claude Code 로그인이 만료됐습니다. Claude Code를 한 번 실행하면 자동으로 갱신됩니다.");
    }
    return oauth;
  }
  return {
    file,
    // 상태 표시용(토큰은 돌려주지 않는다)
    describe() {
      const oauth = read();
      return { plan: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : "", expiresAt: oauth.expiresAt ?? null };
    },
    accessToken: provider(() => read().accessToken, "Claude Code 로그인"),
  };
}

function savedToken(value) {
  return isOAuthToken(value) ? provider(() => value, "Claude Code 토큰") : null;
}

module.exports = { claudeCodeLogin, savedToken, isOAuthToken, API_VERSION };
