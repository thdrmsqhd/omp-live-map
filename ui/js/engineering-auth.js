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

// 예산 입력 이름. 구독 로그인(Claude Code)은 청구 금액이 아니라 호출 전에 토큰 수로 미리 잡는 예약 상한이므로 이름과 안내를 바꾼다.
const ENGINEERING_BUDGET_WORDS = {
  api: { run: "실행 예산(센트)", trial: "실행별 예산(센트)", loop: "예산(센트)", project: "프로젝트 예산(센트)",
    hint: "모델을 부르기 전에 넉넉하게 미리 잡는 상한입니다. 실제 청구 금액은 보통 이보다 적습니다." },
  subscription: { run: "호출 예약 상한(센트)", trial: "실행별 호출 예약 상한(센트)", loop: "호출 예약 상한(센트)", project: "프로젝트 호출 예약 상한(센트)",
    hint: "구독 로그인은 이 금액을 청구하지 않습니다. 모델을 부르기 전에 토큰 수로 미리 잡는 안전 상한이며, 다 쓰면 실행이 멈춥니다. 실제 사용량은 Claude 구독 한도에서 차감됩니다." },
};
const engineeringBilling = () => document.documentElement.dataset.billing === "subscription" ? "subscription" : "api";
function engineeringBudgetLabel(kind) { return ENGINEERING_BUDGET_WORDS[engineeringBilling()][kind] ?? ENGINEERING_BUDGET_WORDS.api[kind]; }
function engineeringApplyBudgetWording(runtime, root = document) {
  if (runtime?.auth) document.documentElement.dataset.billing = runtime.auth.billing === "subscription" ? "subscription" : "api";
  const words = ENGINEERING_BUDGET_WORDS[engineeringBilling()];
  for (const label of root.querySelectorAll("[data-budget]")) {
    label.textContent = words[label.dataset.budget] ?? label.textContent;
    label.closest("label")?.setAttribute("title", words.hint);
  }
  for (const hint of root.querySelectorAll("[data-budget-hint]")) {
    hint.textContent = words.hint;
    hint.hidden = engineeringBilling() !== "subscription";
  }
}
