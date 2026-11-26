export function bindRuntimeControls({ find, request, report, status, formValues }) {
  const login = find("console-login");
  let signingIn = false;
  let loginRequest = false;

  function render(current) {
    const busy = ["checking", "building"].includes(current.status);
    signingIn = current.signingIn;
    find("runtime-status").textContent = current.detail + engineeringLoginExpiry(current);
    find("runtime-status").dataset.tone = current.status === "login-expired" || engineeringLoginWarning(current, 30 * 60000) ? "warn" : "";
    engineeringApplyBudgetWording(current);
    find("prepare-runtime").disabled = busy || current.status === "ready";
    find("check-runtime").disabled = busy;
    find("console-login-status").textContent = current.loginStatus;
    login.disabled = !current.canLogin || loginRequest;
    login.textContent = signingIn ? "로그인 취소" : "Claude Console 로그인";
  }

  async function runtimeStatus() {
    render(await request("runtime"));
  }

  for (const [id, build] of [["prepare-runtime", true], ["check-runtime", false]]) {
    find(id).addEventListener("click", report(async () => {
      render(await request("runtime", {}, { build }));
    }));
  }
  login.addEventListener("click", report(async () => {
    loginRequest = true;
    login.disabled = true;
    try {
      await request("runtime/login", {}, { cancel: signingIn });
    } finally {
      loginRequest = false;
      await runtimeStatus();
    }
  }));
  find("provider-key").addEventListener("submit", report(async (event) => {
    const { value } = formValues(event);
    event.currentTarget.reset();
    await request("runtime/key", {}, { value });
    status.textContent = "Windows 사용자 비밀 저장소에 키를 저장했습니다.";
  }));
  find("remove-key").addEventListener("click", report(async () => {
    await request("runtime/key", {}, { remove: true });
    status.textContent = "저장된 키를 삭제했습니다.";
  }));

  return runtimeStatus;
}
