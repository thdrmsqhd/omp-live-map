/* omp-live-map · viewmodel · 파일 트리와 로컬 카드 자원 조회 */

async function loadTree(id, dirPath) {
  // 마지막 요청만 반영한다(↻ 연타·cwd 이동이 겹칠 때).
  const tok = {};
  TREES.set(id, { path: dirPath, entries: [], loading: true, tok });
  paintTree(id);
  let data;
  try {
    const res = await fetch("/api/tree?p=" + encodeURIComponent(dirPath || "") + "&d=2");
    data = await res.json();
  } catch {
    data = { path: dirPath, entries: [], error: "load failed" };
  }
  if (!TREES.has(id) || TREES.get(id).tok !== tok) return;
  TREES.set(id, data);
  paintTree(id);
}

function findTreeEntry(entries, dirPath) {
  for (const e of entries) {
    if (e.path === dirPath) return e;
    const hit = e.dir && e.children ? findTreeEntry(e.children, dirPath) : null;
    if (hit) return hit;
  }
  return null;
}

// 서버는 두 단계까지만 주므로, 더 깊은 폴더는 펼칠 때 한 단계씩 읽어 트리에 끼운다.
async function loadTreeChildren(id, dirPath) {
  const data = TREES.get(id);
  const entry = data && findTreeEntry(data.entries || [], dirPath);
  if (!entry || entry.children !== undefined || entry.loading) return;
  entry.loading = true;
  try {
    const res = await fetch("/api/tree?p=" + encodeURIComponent(dirPath) + "&d=1");
    entry.children = (await res.json()).entries || [];
  } catch {
    entry.children = [];
  }
  entry.loading = false;
  if (TREES.get(id) === data) paintTree(id);
}

// 터미널 cwd 와 파일 트리 루트를 함께 옮긴다.
function setCwd(id, targetPath, isFile) {
  const st = termState(nodeById(id));
  const dir = isFile ? String(targetPath).replace(/[\\/][^\\/]*$/, "") : String(targetPath);
  st.cwd = dir;
  termLog(id, [{ t: "# " + dir, c: "sys" }]);
  loadTree(id, dir);
}

const parentDir = (p) => {
  const s = String(p || "").replace(/[\\/]+$/, "");
  const up = s.replace(/[\\/][^\\/]*$/, "");
  return up && up !== s ? (/^[A-Za-z]:$/.test(up) ? up + "/" : up) : "";
};

async function loadLocalRes() {
  let changed = false;
  for (const L of LOCALS) {
    try {
      const r = await fetch("/api/res?cwd=" + encodeURIComponent(L.cwd) + "&node=" + encodeURIComponent(L.id));
      const j = await r.json();
      if (JSON.stringify(LOCRES.get(L.id)) !== JSON.stringify(j)) { LOCRES.set(L.id, j); changed = true; }
    } catch { /* ignore */ }
  }
  if (changed) renderMap(false);
}
