/* omp-live-map · viewmodel · 세션 컨텍스트 보기·편집(작업 가이드·압축) */

// 카드를 열 때 기록에서 현재 컨텍스트를 읽어 온다. 다시 읽기는 20초에 한 번만(라이브 턴 중 연속 렌더 대비).
const CTX_TTL = 20000;

function ctxState(id) {
  if (!CTX.has(id)) {
    CTX.set(id, { data: null, error: "", loading: false, draft: "", omit: new Set(), busy: false, msg: "", at: 0 });
  }
  return CTX.get(id);
}

async function loadContext(id, force) {
  const st = ctxState(id);
  if (st.loading) return;
  if (!force && st.at && Date.now() - st.at < CTX_TTL) return;
  st.loading = true;
  if (!st.data) viewUpdates.context?.(id);
  let data;
  try {
    const res = await fetch("/api/context?node=" + encodeURIComponent(id));
    data = await res.json();
  } catch (e) {
    data = { ok: false, out: "읽기 실패: " + e.message };
  }
  st.loading = false;
  st.at = Date.now();
  if (data.ok) { st.data = data; st.error = ""; } else st.error = data.out || "컨텍스트를 읽지 못했습니다";
  viewUpdates.context?.(id);
}

// 압축 지시문에서 뺄 항목 토글.
function toggleCtxOmit(id, i) {
  const st = ctxState(id);
  const n = Number(i);
  if (st.omit.has(n)) st.omit.delete(n); else st.omit.add(n);
  viewUpdates.context?.(id);
}

// 편집: guide = 작업 가이드를 맵 세션에 보내기(도는 중이면 steer), compact = 지시문을 붙여 컨텍스트 압축.
async function editContext(id, mode) {
  const st = ctxState(id);
  if (st.busy) return;
  const text = (st.draft || "").trim();
  if (!text && mode === "guide") { st.msg = "작업 가이드를 입력하세요"; viewUpdates.context?.(id); return; }
  st.busy = true;
  st.msg = mode === "compact" ? "압축하는 중…" : "보내는 중…";
  viewUpdates.context?.(id);
  let out;
  try {
    const res = await postJSON("/api/context", {
      node: id, mode, text,
      omit: mode === "compact" ? [...st.omit] : undefined,
    });
    out = await res.json();
  } catch (e) {
    out = { ok: false, out: e.message };
  }
  st.busy = false;
  if (out.ok) {
    st.msg = mode === "compact" ? "압축했습니다. 기록에서 다시 읽는 중…" : "가이드를 보냈습니다";
    st.draft = "";
    if (mode === "compact") { st.omit.clear(); st.data = null; }
    st.at = 0;
    if (mode === "compact") setTimeout(() => loadContext(id, true), 1200);
  } else {
    st.msg = "실패: " + (out.out || "응답 없음") + (out.held ? " (터미널 세션은 보기만 합니다)" : "");
  }
  viewUpdates.context?.(id);
}
