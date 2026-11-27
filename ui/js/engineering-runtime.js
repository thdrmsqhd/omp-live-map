// 위쪽 막대의 실행 환경 점: '● omp · claude'. 이 PC 에서 CLI 를 못 찾으면 빨간 점과 함께 빠진 이름을 지운 줄로 보여 준다.
// 누르면 다시 확인한다. 키·로그인은 앱이 받지 않는다(각 CLI 설정을 쓴다).
const NAMES = [["omp", "omp"], ["claude", "claude"]];

export function bindRuntimeDot({ request }) {
  const dot = document.getElementById("runtime-dot");
  if (!dot) return async () => {};
  let timer = 0;
  function render(current) {
    const missing = NAMES.filter(([id]) => current.status === "ready" ? !current[id] : current.status === "unavailable");
    dot.replaceChildren(Object.assign(document.createElement("i"), { textContent: "●" }),
      ...NAMES.flatMap(([id, label], index) => [index ? " · " : " ", Object.assign(document.createElement(missing.some(([name]) => name === id) ? "s" : "span"), { textContent: label })]));
    dot.dataset.tone = current.status === "checking" || current.status === "unchecked" ? "wait" : missing.length ? "bad" : "ok";
    dot.title = (current.detail || "") + " · 눌러서 다시 확인";
    clearTimeout(timer);
    if (current.status === "checking" || current.status === "unchecked") timer = setTimeout(() => void status(), 1500);
  }
  async function status(recheck = false) {
    try { render(await request("runtime", {}, recheck ? {} : undefined)); }
    catch (error) { render({ status: "unavailable", detail: error.message }); }
  }
  dot.addEventListener("click", () => void status(true));
  setInterval(() => { if (!document.hidden) void status(); }, 60000);
  void status();
  return status;
}
