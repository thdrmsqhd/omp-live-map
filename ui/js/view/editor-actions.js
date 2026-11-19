/* omp-live-map · view · 편집기 동작: 저장(Ctrl+S)·정의 이동(F12)·진단 표시(600ms 디바운스). 인자 s = 카드의 편집기 상태 */

function edCount(s) {
  const f = edFile(s);
  if (!f || !edMonaco) return edSetProblem(s, 0, 0);
  const ms = edMonaco.editor.getModelMarkers({ resource: f.model.uri });
  edSetProblem(s, ms.filter((m) => m.severity === 8).length, ms.filter((m) => m.severity === 4).length);
}

function edChanged(s) {
  const f = edFile(s);
  if (!f || f.model !== s.editor.getModel()) return;
  if (!f.dirty) {
    f.dirty = true;
    if (s.preview === s.active) s.preview = null;   // 고친 파일은 미리보기가 아니라 고정 탭
    edPaintFile(s.active);
  }
  edSetMsg(s, "수정됨", "dirty");
  edScheduleDiag(s);
}

function edScheduleDiag(s) {
  clearTimeout(s.diagTimer);
  s.diagTimer = setTimeout(() => edDiag(s), 600);
}

// Python 진단은 서버(pyright)가 준다. JS/TS 는 Monaco 내장 TypeScript 서비스가 알아서 마커를 단다.
async function edDiag(s) {
  const f = edFile(s);
  if (!f || !s.editor || f.model.getLanguageId() !== "python") return s.editor && edCount(s);
  const seq = ++s.diagSeq;
  const file = s.active;
  const r = await edDiagnostics(file, f.model.getValue());
  if (seq !== s.diagSeq || ED_FILES.get(file) !== f || !ED.has(s.id)) return;
  if (!r.ok) return edSetMsg(s, r.error || "진단을 받지 못했습니다", "bad");
  edMonaco.editor.setModelMarkers(f.model, "pylsp", edMarkers(r.items));
  edCount(s);
}

async function edSave(s) {
  const f = edFile(s);
  if (!f || !s.editor) return;
  const file = s.active;
  edSetMsg(s, "저장 중…");
  let r = await edWrite(file, f.model.getValue(), f.mtime);
  if (r.status === 409) {
    if (!confirm("파일이 다른 곳에서 바뀌었습니다. 덮어쓸까요?")) return edSetMsg(s, "저장 취소(파일이 바뀜)", "bad");
    r = await edWrite(file, f.model.getValue(), null);
  }
  if (!r.ok) return edSetMsg(s, r.error || "저장 실패", "bad");
  f.mtime = r.mtime;
  f.dirty = false;
  edPaintFile(file);
  edSetMsg(s, "저장됨");
  edScheduleDiag(s);
}

async function edGoto(s) {
  const f = edFile(s);
  if (!f || !s.editor) return;
  const pos = s.editor.getPosition();
  if (!pos) return;
  const file = s.active;
  const lang = f.model.getLanguageId();
  try {
    if (lang === "python") {
      const r = await edDefinition(file, f.model.getValue(), pos.lineNumber - 1, pos.column - 1);
      if (!r.ok) return edSetMsg(s, r.error || "언어 서버 오류", "bad");
      const loc = (r.locations || [])[0];
      if (!loc) return edSetMsg(s, "정의를 찾지 못했습니다");
      return await edOpenAt(s, loc.path, loc.line, loc.character);   // 다른 파일은 같은 카드의 새 탭
    }
    if (lang === "javascript" || lang === "typescript") {
      const ts = edMonaco.languages.typescript;
      const worker = await (lang === "typescript" ? ts.getTypeScriptWorker() : ts.getJavaScriptWorker());
      const client = await worker(f.model.uri);
      const defs = await client.getDefinitionAtPosition(f.model.uri.toString(), f.model.getOffsetAt(pos));
      const d = defs && defs[0];
      if (!d) return edSetMsg(s, "정의를 찾지 못했습니다");
      if (d.fileName !== f.model.uri.toString()) return edSetMsg(s, "다른 파일의 정의는 직접 열어 주세요");
      const target = f.model.getPositionAt(d.textSpan.start);
      s.editor.setPosition(target);
      s.editor.revealPositionInCenter(target);
      s.editor.focus();
      edSetMsg(s, "정의로 이동: " + target.lineNumber + "행");
    }
  } catch (e) {
    edSetMsg(s, "정의 이동 실패: " + (e.message || e), "bad");
  }
}
