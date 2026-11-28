/* omp-live-map · view · VS Code형 코드 편집기 상태(카드별 Monaco·탭·상태바). 탐색기는 editor-explorer.js, 동작은 editor-actions.js, 블록은 block-editor.js */

// 파일 레코드는 경로당 하나(Monaco 모델 URI 가 겹치지 않게). 여러 카드가 같은 파일을 열면 모델·미저장 내용·mtime 을 공유한다.
const ED_FILES = new Map(); // 절대경로 -> {model, mtime, dirty, refs:Set<카드 id>}
const ED = new Map();       // 카드 id -> {id, root, editor, tabs:Map<경로, 뷰 상태>, active, preview, exp:Set, fq, focus, diagTimer, diagSeq}
let edMarkerHooked = false;
let edPyright = null;       // Python 언어 서버 발견 여부(상태바 표시용)
let edJava = false;           // Java 언어 서버(JDT LS) 설치 여부

const ED_LANG_NAME = { plaintext: "Plain Text", javascript: "JavaScript", typescript: "TypeScript", json: "JSON", css: "CSS", html: "HTML",
  markdown: "Markdown", python: "Python", yaml: "YAML", shell: "Shell Script", xml: "XML", powershell: "PowerShell", cpp: "C++", csharp: "C#" };

const edBase = (p) => String(p).split(/[\\/]/).pop();
const edFile = (s) => (s && s.active ? ED_FILES.get(s.active) : null);
const edQ = (s, sel) => s.root.querySelector(sel);

function edSetMsg(s, msg, cls) {
  const m = edQ(s, ".edp-msg");
  m.textContent = msg || "";
  m.className = "edp-msg" + (cls ? " " + cls : "");
}

// 상태바 문제 수: ⊗ 오류 ⚠ 경고
function edSetProblem(s, err, warn) {
  const p = edQ(s, ".edp-prob");
  p.textContent = "⊗ " + err + "  ⚠ " + warn;
  p.classList.toggle("bad", err > 0);
}

// 상태바 오른쪽: 줄·열, 언어, 언어 서버 상태
function edPaintStatus(s) {
  const m = s.editor && s.editor.getModel();
  const pos = m && s.editor.getPosition();
  edQ(s, ".edst-pos").textContent = pos ? `줄 ${pos.lineNumber}, 열 ${pos.column}` : "";
  const lang = m ? m.getLanguageId() : "";
  edQ(s, ".edst-lang").textContent = m ? ED_LANG_NAME[lang] || lang : "";
  const lsp = lang === "python" ? (edPyright === null ? "" : edPyright ? "LSP: pyright" : "LSP: 없음")
    : lang === "java" ? (edJava ? "LSP: JDT LS" : "LSP: 없음")
    : lang === "javascript" || lang === "typescript" ? "LSP: TypeScript" : "";
  const el = edQ(s, ".edp-lsp");
  el.textContent = lsp;
  el.classList.toggle("bad", lsp === "LSP: 없음");
}


// 카드 상태. DOM 루트(root)는 카드 바디가 다시 만들어져도 살아남고, block-editor.js 가 mount 마다 다시 붙인다.
function edState(id) {
  let s = ED.get(id);
  if (s) return s;
  const root = document.createElement("div");
  root.className = "edblk empty";
  root.innerHTML = `<div class="edwb">
      <div class="edact"><button class="edact-b on" data-edact="explorer" title="탐색기 (사이드바 접기/펼치기)"><i class="ic-ex"></i></button></div>
      <div class="edside">
        <div class="edside-h"><span>탐색기</span>
          <button data-ex="up" title="상위 폴더로 이동">↑</button><button data-ex="reload" title="새로고침">↻</button><button data-ex="collapse" title="폴더 모두 접기">⊟</button></div>
        <div class="edroot"></div>
        <input class="edfq" aria-label="탐색기 경로 필터" autocomplete="off" spellcheck="false" placeholder="경로 필터">
        <div class="extree"></div>
      </div>
      <div class="edsash" title="끌어서 폭 조절 · 더블클릭으로 원래대로"></div>
      <div class="edmain">
        <div class="edtabs"></div>
        <div class="edcrumb"></div>
        <div class="edp-body"><div class="edmon"></div>
          <div class="edwelcome"><b>코드 편집기</b><span class="edw-msg">왼쪽 탐색기에서 파일을 클릭하면 탭으로 열립니다</span>
            <span class="edw-keys">클릭 = 미리보기 · 더블클릭 = 고정 · Ctrl+S 저장 · F12 정의로 이동</span></div></div>
      </div>
    </div>
    <div class="edst"><span class="edst-l"><span class="edp-prob">⊗ 0  ⚠ 0</span><span class="edp-msg"></span></span>
      <span class="edst-r"><span class="edst-pos"></span><span class="edst-lang"></span><span class="edp-lsp"></span></span></div>`;
  s = { id, root, editor: null, tabs: new Map(), active: null, preview: null, exp: new Set(), fq: "", focus: false, diagTimer: null, diagSeq: 0 };
  ED.set(id, s);
  edApplySide(s);
  edWireTabs(s);
  edWireExplorer(s);
  // 휠은 편집기 안에서 끝낸다(지도 이동·확대, 브라우저 Ctrl+휠 확대로 새지 않게).
  root.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  if (edPyright === null) edLspStatus().then((st) => { edPyright = !!st.pyright; edJava = !!st.java; for (const x of ED.values()) edPaintStatus(x); });
  return s;
}

// 탭 줄·브레드크럼·빈 상태. 키 입력마다 불리지 않게 탐색기 강조는 edSelect 가 따로 맡는다.
function edPaintTabs(s) {
  edQ(s, ".edtabs").innerHTML = [...s.tabs.keys()].map((p) => {
    const f = ED_FILES.get(p);
    const cls = (p === s.active ? " on" : "") + (f && f.dirty ? " dirty" : "") + (p === s.preview ? " prev" : "");
    return `<div class="edt${cls}" data-path="${esc(p)}" title="${esc(p)}">${fileIcon(edBase(p))}<span class="edt-n">${esc(edBase(p))}</span><b class="edx" data-edclose="${esc(p)}" title="닫기"></b></div>`;
  }).join("");
  const on = edQ(s, ".edt.on");
  if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  s.root.classList.toggle("empty", !s.active);
  edPaintCrumb(s);
}

// 그 파일을 가진 모든 카드의 탭 표시(수정 점)를 갱신한다.
function edPaintFile(path) {
  const f = ED_FILES.get(path);
  if (!f) return;
  for (const id of f.refs) { const s = ED.get(id); if (s) edPaintTabs(s); }
}

function edShow(s, path, focus = true) {
  const f = ED_FILES.get(path);
  if (!f || !s.editor || !s.tabs.has(path)) return;
  if (s.active && s.active !== path && s.tabs.has(s.active)) s.tabs.set(s.active, s.editor.saveViewState());
  s.active = path;
  s.editor.setModel(f.model);
  const vs = s.tabs.get(path);
  if (vs) s.editor.restoreViewState(vs);
  if (focus) s.editor.focus();
  edPaintTabs(s);
  exSelect(s);
  edSetMsg(s, f.dirty ? "수정됨" : "저장됨", f.dirty ? "dirty" : "");
  edCount(s);
  edPaintStatus(s);
  edScheduleDiag(s);
}

function edAddFile(s, monaco, path, text, mtime) {
  let f = ED_FILES.get(path);
  if (f) {
    if (!f.dirty) {
      if (f.model.getValue() !== text) f.model.setValue(text);
      f.mtime = mtime;
    }
  } else {
    f = { model: monaco.editor.createModel(text, edLang(path), monaco.Uri.file(path)), mtime, dirty: false, refs: new Set() };
    ED_FILES.set(path, f);
  }
  f.refs.add(s.id);
  if (!s.tabs.has(path)) s.tabs.set(path, null);
  return f;
}

function edStart(s, monaco) {
  if (s.editor) return;
  const ed = monaco.editor.create(edQ(s, ".edmon"), {
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "line",
  });
  s.editor = ed;
  ed.onDidChangeModelContent(() => edChanged(s));
  ed.onDidChangeCursorPosition(() => edPaintStatus(s));
  ed.onDidFocusEditorText(() => { s.focus = true; });
  ed.onDidBlurEditorText(() => { if (s.root.isConnected) s.focus = false; });   // 바디가 다시 붙는 중의 blur 는 무시
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => edSave(s));
  // Python 은 우리 LSP 로, JS/TS 는 Monaco 내장 TypeScript 서비스로 정의를 찾는다.
  ed.addCommand(monaco.KeyCode.F12, () => {
    const m = ed.getModel();
    const lang = m && m.getLanguageId();
    if (lang === "python" || lang === "java" || lang === "javascript" || lang === "typescript") edGoto(s);
  });
  // Ctrl+클릭 정의 이동(Python). JS/TS 는 Monaco 내장 링크가 같은 일을 한다.
  ed.onMouseDown((e) => {
    const f = edFile(s);
    if (!f || !e.target.position || !(e.event.ctrlKey || e.event.metaKey)) return;
    if (["python", "java"].includes(f.model.getLanguageId())) edGoto(s);
  });
  if (!edMarkerHooked) {
    edMarkerHooked = true;
    monaco.editor.onDidChangeMarkers(() => { for (const x of ED.values()) if (x.editor) edCount(x); });
  }
}
