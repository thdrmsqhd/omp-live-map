/* omp-live-map · view · 편집기 탭 닫기·카드 정리·파일 열기(openEditor = 탐색기·정의 이동 진입점) */

function edCloseTab(s, path) {
  const f = ED_FILES.get(path);
  if (!f || !s.tabs.has(path)) return;
  if (f.dirty && f.refs.size < 2 && !confirm(`'${path}' 의 변경을 저장하지 않았습니다. 닫을까요?`)) return;
  if (s.active === path) { s.editor?.setModel(null); s.active = null; }
  edRelease(s, path, true);
  const next = [...s.tabs.keys()].pop();
  if (next) { if (s.editor) edShow(s, next); else { s.active = next; void edResume(s); } }
  else {
    edPaintTabs(s);
    exSelect(s);
    edSetMsg(s, "");
    edSetProblem(s, 0, 0);
    edPaintStatus(s);
  }
}

// 카드가 파일을 놓는다. 마지막 참조면 모델을 dispose 한다.
function edRelease(s, path, discard = false) {
  s.tabs.delete(path);
  if (s.preview === path) s.preview = null;
  const f = ED_FILES.get(path);
  if (!f) return;
  f.refs.delete(s.id);
  // 카드 닫기나 블록 제거 시 미저장 모델은 보존한다. 명시적 탭 닫기만 폐기한다.
  if (!f.refs.size && (!f.dirty || discard)) { f.model.dispose(); ED_FILES.delete(path); }
}

// 카드를 닫거나 편집기 블록을 뺄 때: 그 카드의 Monaco 인스턴스·탭·모델 참조를 모두 정리한다.
function edDispose(id) {
  const s = ED.get(id);
  if (!s) return;
  clearTimeout(s.diagTimer);
  if (s.editor) { s.editor.setModel(null); s.editor.dispose(); }
  for (const p of [...s.tabs.keys()]) edRelease(s, p);
  s.root.remove();
  ED.delete(id);
}

// 정의 이동: 다른 파일은 같은 카드의 고정 탭으로 열고 그 위치로 간다.
async function edOpenAt(s, path, line, character) {
  await openEditor(s.id, path, { pin: true });
  if (s.active !== path) return;
  const pos = { lineNumber: line + 1, column: character + 1 };
  s.editor.setPosition(pos);
  s.editor.revealPositionInCenter(pos);
  s.editor.focus();
  edSetMsg(s, "정의로 이동: " + edBase(path) + ":" + (line + 1));
}

// 새 미리보기 탭이 생기면 이전 미리보기 탭(미저장 아님)은 그 자리에서 교체한다.
function edDropPreview(s, keep) {
  const prev = s.preview;
  if (!prev || prev === keep || !s.tabs.has(prev)) return;
  const f = ED_FILES.get(prev);
  if (f && f.dirty) return;
  if (s.active === prev) { s.editor?.setModel(null); s.active = null; }
  edRelease(s, prev);
}

// 탐색기 클릭/더블클릭(opts.pin)·F12 가 부른다. 편집기 블록이 없는 옛 카드에는 블록을 더한다.
async function openEditor(nodeId, path, opts) {
  const node = nodeById(nodeId);
  if (!node) return;
  const pin = !!(opts && opts.pin);
  if (!cardBlockTypes(node).includes("editor")) toggleBlock(nodeId, "editor");
  const s = edState(nodeId);
  if (s.editor && s.tabs.has(path)) {
    if (pin) edPin(s, path);
    return edShow(s, path);
  }
  edSetMsg(s, "불러오는 중…");
  try {
    const [monaco, r] = await Promise.all([loadMonaco(), edRead(path)]);
    if (!r.ok) throw new Error(r.error || "파일을 열 수 없습니다");
    if (ED.get(nodeId) !== s) return;   // 읽는 사이 카드가 닫혔다
    edStart(s, monaco);
    if (s.tabs.has(path)) { if (pin) edPin(s, path); return edShow(s, path); }   // 읽는 사이 같은 파일이 열렸다
    if (!pin) edDropPreview(s, path);
    edAddFile(s, monaco, path, r.text, r.mtime);
    if (!pin) s.preview = path;
    edShow(s, path);
  } catch (e) {
    const msg = e.message || String(e);
    edSetMsg(s, msg, "bad");
    if (!s.editor) edQ(s, ".edw-msg").textContent = msg;
  }
}

addEventListener("beforeunload", (event) => {
  if ([...ED_FILES.values()].some((f) => f.dirty)) { event.preventDefault(); event.returnValue = ""; }
});

// 비활성 카드에서는 편집기 인스턴스만 해제한다. 모델, 파일 참조, 탭, 뷰 상태는 유지한다.
function edSuspend(id) {
  const s = ED.get(id);
  if (!s || !s.editor) return;
  if (s.active && s.tabs.has(s.active)) s.tabs.set(s.active, s.editor.saveViewState());
  clearTimeout(s.diagTimer); s.diagSeq++;
  s.focus = false;
  s.editor.setModel(null); s.editor.dispose(); s.editor = null;
  // Preserve dirty files and undo history; only release unreferenced clean models.
  for(const [file,f] of ED_FILES)if(!f.dirty&&!f.refs.size){f.model.dispose();ED_FILES.delete(file);}
}
async function edResume(s) {
  if (!s.active || s.editor || s.resuming) return;
  s.resuming = true;
  try {
    const monaco = await loadMonaco();
    if (ED.get(s.id) !== s || !s.root.isConnected || !s.active || s.editor) return;
    edStart(s, monaco);
    edShow(s, s.active, false);
  } catch(e) { edSetMsg(s, "편집기 복원 실패: " + e.message, "bad"); }
  finally { s.resuming = false; }
}
