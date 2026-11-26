// 실행 환경 인증 안내. 관제(index.html)와 Engineering(engineering.html)이 함께 쓰는 일반 스크립트다.
// runtime 은 서버 "runtime" 응답(status·detail·auth{kind, billing, expiresAt})이다.

// Claude Code 로그인이 실행 도중 만료될 수 있으면(시간 제한 + 5분 안에 만료) 시작 전에 보여 줄 문구를 돌려준다.
function engineeringLoginWarning(runtime, timeoutMs = 0) {
  if (runtime?.status === "login-expired") return runtime.detail;
  const until = runtime?.auth?.kind === "claude-code-login" ? runtime.auth.expiresAt : null;
  if (!Number.isFinite(until)) return "";
  const left = until - Date.now();
  if (left > timeoutMs + 5 * 60000) return "";
  const at = new Date(until).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return "Claude Code 로그인이 " + at + "에 만료됩니다(약 " + Math.max(0, Math.round(left / 60000)) + "분 남음). " +
    "실행 시간 제한보다 짧아 도중에 실패할 수 있습니다. Claude Code를 한 번 실행해 로그인을 갱신한 뒤 시작하세요.";
}

// 실행 환경 상태 줄에 붙이는 로그인 만료 시각(Claude Code 로그인일 때만).
function engineeringLoginExpiry(runtime) {
  const until = runtime?.auth?.kind === "claude-code-login" ? runtime.auth.expiresAt : null;
  if (!Number.isFinite(until) || runtime.status !== "ready") return "";
  const left = Math.round((until - Date.now()) / 60000);
  const at = new Date(until).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return " · 로그인 만료 " + at + " (약 " + (left >= 120 ? Math.floor(left / 60) + "시간" : left + "분") + " 남음, Claude Code가 갱신)";
}
