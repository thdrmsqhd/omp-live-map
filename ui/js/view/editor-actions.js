/* omp-live-map · view · 편집기 동작: 저장(Ctrl+S)·정의 이동(F12)·진단 표시(600ms 디바운스) */

let edDiagTimer = null;
let edDiagSeq = 0;

function edCount() {
  const t = edActive && ED_TABS.get(edActive);
  if (!t || !edMonaco) return edSetProblem(0);
  edSetProblem(edMonaco.editor.getModelMarkers({ resource: t.model.uri }).length);
}

function edChanged() {
  const t = edActive && ED_TABS.get(edActive);
  if (!t || !edEditor || t.model !== edEditor.getModel()) return;
  t.dirty = true;
  edPaintTabs();
  edSetMsg("수정됨", "dirty");
  edScheduleDiag();
}

function edScheduleDiag() {
  clearTimeout(edDiagTimer);
  edDiagTimer = setTimeout(() => edDiag(), 600);
}

// Python 진단은 서버(pyright)가 준다. JS/TS 는 Monaco 내장 TypeScript 서비스가 알아서 마커를 단다.
async function edDiag() {
  const t = edActive && ED_TABS.get(edActive);
  if (!t || !edEditor || t.model.getLanguageId() !== "python") return edCount();
  const seq = ++edDiagSeq;
  const r = await edDiagnostics(edActive, t.model.getValue());
  if (seq !== edDiagSeq || ED_TABS.get(edActive) !== t) return;
  if (!r.ok) return edSetMsg(r.error || "진단을 받지 못했습니다", "bad");
  edMonaco.editor.setModelMarkers(t.model, "pylsp", edMarkers(r.items));
  edCount();
}

async function edSave() {
  const t = edActive && ED_TABS.get(edActive);
  if (!t || !edEditor) return;
  const file = edActive;
  edSetMsg("저장 중…");
  let r = await edWrite(file, t.model.getValue(), t.mtime);
  if (r.status === 409) {
    if (!confirm("파일이 다른 곳에서 바뀌었습니다. 덮어쓸까요?")) return edSetMsg("저장 취소(파일이 바뀜)", "bad");
    r = await edWrite(file, t.model.getValue(), null);
  }
  if (!r.ok) return edSetMsg(r.error || "저장 실패", "bad");
  t.mtime = r.mtime;
  t.dirty = false;
  edPaintTabs();
  edSetMsg("저장됨");
  edScheduleDiag();
}

async function edGoto() {
  const t = edActive && ED_TABS.get(edActive);
  if (!t || !edEditor) return;
  const pos = edEditor.getPosition();
  if (!pos) return;
  const file = edActive;
  const lang = t.model.getLanguageId();
  try {
    if (lang === "python") {
      const r = await edDefinition(file, t.model.getValue(), pos.lineNumber - 1, pos.column - 1);
      if (!r.ok) return edSetMsg(r.error || "언어 서버 오류", "bad");
      const loc = (r.locations || [])[0];
      if (!loc) return edSetMsg("정의를 찾지 못했습니다");
      return await edOpenAt(loc.path, loc.line, loc.character);
    }
    if (lang === "javascript" || lang === "typescript") {
      const ts = edMonaco.languages.typescript;
      const worker = await (lang === "typescript" ? ts.getTypeScriptWorker() : ts.getJavaScriptWorker());
      const client = await worker(t.model.uri);
      const defs = await client.getDefinitionAtPosition(t.model.uri.toString(), t.model.getOffsetAt(pos));
      const d = defs && defs[0];
      if (!d) return edSetMsg("정의를 찾지 못했습니다");
      if (d.fileName !== t.model.uri.toString()) return edSetMsg("다른 파일의 정의는 직접 열어 주세요");
      const target = t.model.getPositionAt(d.textSpan.start);
      edEditor.setPosition(target);
      edEditor.revealPositionInCenter(target);
      edEditor.focus();
      edSetMsg("정의로 이동: " + target.lineNumber + "행");
    }
  } catch (e) {
    edSetMsg("정의 이동 실패: " + (e.message || e), "bad");
  }
}
