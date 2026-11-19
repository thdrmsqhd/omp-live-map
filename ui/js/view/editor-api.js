/* omp-live-map · view · 편집기 API 호출 (읽기·쓰기·정의·진단·언어 서버 상태) */

async function edPost(url, body) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, error: "응답을 읽지 못했습니다" }));
    return { status: r.status, ...j };
  } catch (e) {
    return { status: 0, ok: false, error: "서버에 연결하지 못했습니다(" + (e.message || e) + ")" };
  }
}

const edRead = (path) => edPost("/api/editor/read", { path });
const edWrite = (path, text, mtime) => edPost("/api/editor/write", { path, text, mtime });
const edDefinition = (path, text, line, character) => edPost("/api/editor/definition", { path, text, line, character });
const edDiagnostics = (path, text) => edPost("/api/editor/diagnostics", { path, text });

let edStatusPromise = null;
function edLspStatus() {
  if (!edStatusPromise) {
    edStatusPromise = fetch("/api/editor/status")
      .then((r) => r.json())
      .catch(() => ({ pyright: false }));
  }
  return edStatusPromise;
}
