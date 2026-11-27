// Engineering API 호출: 웹 브라우저와 데스크톱 앱이 똑같이 같은 출처 HTTP(/api/engineering/*)로 부른다.
// 서버 시작마다 만든 토큰은 index.html 에 심겨 오므로(같은 출처만 읽을 수 있다) 헤더로 돌려보낸다.
// 돌려주는 값: 성공이면 { ok: true, value }, 실패면 { ok: false, error }.
// 데스크톱 앱만 네이티브 폴더 대화상자(pickFolder)를 더한다. 웹에서는 경로를 직접 입력한다.
const ENGINEERING_TOKEN = document.querySelector('meta[name="omp-ops-token"]')?.content || "";

async function engineeringRequest(endpoint, params, payload) {
  const query = new URLSearchParams(params ?? {}).toString();
  const url = "/api/engineering/" + endpoint + (query ? "?" + query : "");
  try {
    const response = await fetch(url, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Omp-Ops-Token": ENGINEERING_TOKEN },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: "same-origin",
      redirect: "error",
    });
    let value = null;
    try { value = await response.json(); } catch { /* 본문이 JSON 이 아닌 오류 */ }
    return response.ok ? { ok: true, value } : { ok: false, error: value?.error || "요청에 실패했습니다 (" + response.status + ")" };
  } catch (error) {
    return { ok: false, error: "서버에 연결하지 못했습니다." };
  }
}

// 작업 폴더 고르기: 데스크톱 앱은 네이티브 폴더 대화상자, 웹은 경로 입력 상자. 결과는 { ok, value | error }.
// 고른 경로는 서버(projects/ensure)가 다시 검사하므로 어느 쪽이든 같은 등록 경로를 쓴다.
async function engineeringPickFolder() {
  if (window.engineeringDesktop?.pickFolder) return window.engineeringDesktop.pickFolder();
  const value = (window.prompt("작업 폴더의 전체 경로를 입력해 주세요 (예: C:\\workspace\\project)") ?? "").trim();
  return value ? { ok: true, value } : { ok: false, error: "폴더를 고르지 않았습니다." };
}

window.engineeringApi = {
  request: engineeringRequest,
  pickFolder: engineeringPickFolder,
  // 폴더 고르기 메뉴 이름: 데스크톱은 대화상자, 웹은 경로 입력.
  pickLabel: window.engineeringDesktop?.pickFolder ? "폴더 선택…" : "폴더 경로 입력…",
};
