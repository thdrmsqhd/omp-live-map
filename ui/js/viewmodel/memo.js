/* omp-live-map · viewmodel · 카드 메모 저장 (localStorage: omp-map-memo) */
//
// nodeId(= 세션 JSONL 경로, 새로고침·재시작 후에도 같다) -> [{id, text}].
// 항목은 한 줄일 수도 여러 줄일 수도 있다(줄바꿈 보존). 경로·프롬프트를 그대로 적어 두고 복사·삽입한다.

const MEMO = new Map();

const memoUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

for (const [id, list] of Object.entries(readJSON("omp-map-memo", {}))) {
  if (!Array.isArray(list)) continue;
  const clean = list
    .filter((m) => m && typeof m.text === "string" && m.text)
    .map((m) => ({ id: String(m.id || memoUid()), text: m.text }));
  if (clean.length) MEMO.set(id, clean);
}

const saveMemo = () => writeJSON("omp-map-memo", Object.fromEntries(MEMO));

const memoList = (id) => MEMO.get(id) || [];

const memoItem = (id, itemId) => memoList(id).find((m) => m.id === itemId) || null;

function memoAdd(id, text) {
  MEMO.set(id, [...memoList(id), { id: memoUid(), text }]);
  saveMemo();
}

function memoUpdate(id, itemId, text) {
  const it = memoItem(id, itemId);
  if (!it) return;
  it.text = text;
  saveMemo();
}

function memoRemove(id, itemId) {
  const list = memoList(id).filter((m) => m.id !== itemId);
  if (list.length) MEMO.set(id, list); else MEMO.delete(id);
  saveMemo();
}
