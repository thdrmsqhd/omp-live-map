/* omp-live-map · viewmodel · 대화 도중 모델 바꾸기 (목록 불러오기·선택·카드 표시 갱신) */

// 선택창 상태. chatState(id).mp 에 둔다.
function modelPick(id) {
  const st = chatState(id);
  if (!st.mp) st.mp = { open: false, loading: false, list: [], current: null, q: "", err: "" };
  return st.mp;
}

// 검색어로 거른 목록. provider·id·이름 어디에 들어 있어도 맞는다.
function modelMatches(mp) {
  const q = mp.q.trim().toLowerCase();
  if (!q) return mp.list;
  return mp.list.filter((m) => (m.provider + "/" + m.id + " " + m.name).toLowerCase().includes(q));
}

async function postOut(url, body) {
  try {
    const res = await postJSON(url, body);
    return await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
  } catch (err) {
    return { ok: false, out: err.message };
  }
}

// 모델 버튼: 선택창을 열며 목록을 새로 받는다. 열려 있으면 닫는다.
async function toggleModelPicker(id) {
  const mp = modelPick(id);
  if (mp.open) { mp.open = false; paintChat(id); return; }
  Object.assign(mp, { open: true, loading: true, err: "", q: "", list: [] });
  paintChat(id);
  const out = await postOut("/api/session/models", { node: id });
  mp.loading = false;
  if (out.ok) { mp.list = out.models || []; mp.current = out.current; }
  else mp.err = (out.held ? "바꿀 수 없음: " : "목록 실패: ") + (out.out || "응답 없음");
  paintChat(id);
}

// 지도 데이터의 해당 노드 모델을 바로 바꿔 카드 표시를 갱신한다. 다음 스냅샷도 같은 값을 가져온다.
function applyNodeModel(id, m) {
  for (const s of DATA.sessions) for (const n of s.nodes) if (n.id === id) { n.model = m.id; n.provider = m.provider; }
  renderMap(false, true);
}

async function pickModel(id, provider, modelId) {
  const st = chatState(id);
  const mp = modelPick(id);
  mp.loading = true;
  mp.err = "";
  paintChat(id);
  const out = await postOut("/api/session/model", { node: id, provider, id: modelId });
  mp.loading = false;
  if (!out.ok) {
    mp.err = "변경 실패: " + (out.out || "응답 없음");
    paintChat(id);
    return;
  }
  const m = out.model || { provider, id: modelId, name: modelId };
  mp.open = false;
  mp.current = m;
  st.modelNote = `모델을 ${m.name || m.id}(으)로 바꿨습니다`
    + (out.busy || st.busy ? " · 지금 도는 턴이 끝나고 다음 턴부터 적용됩니다" : "");
  applyNodeModel(id, m);
  paintChat(id);
}
