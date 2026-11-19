/* omp-live-map · view · 코드 편집기 오버레이(패널·탭·열기/닫기). 동작은 editor-actions.js */

const ED_TABS = new Map(); // 절대경로 -> {model, mtime, dirty, view}
let edEditor = null;
let edBox = null;
let edActive = null;

function edEl(sel) {
  return edBox ? edBox.querySelector(sel) : null;
}

function edSetMsg(msg, cls) {
  const m = edEl(".edp-msg");
  if (!m) return;
  m.textContent = msg || "";
  m.className = "edp-msg" + (cls ? " " + cls : "");
}

function edSetProblem(n) {
  const p = edEl(".edp-prob");
  if (!p) return;
  p.textContent = n ? "문제 " + n : "";
  p.classList.toggle("bad", n > 0);
}

function edEnsurePanel() {
  if (edBox) return;
  edBox = document.createElement("div");
  edBox.id = "editorPanel";
  edBox.className = "edp";
  edBox.innerHTML = `<div class="edp-bar">
      <div class="edp-tabs"></div>
      <div class="edp-info">
        <span class="edp-path"></span><span class="edp-msg"></span><span class="edp-prob"></span><span class="edp-lsp"></span>
      </div>
      <button class="edp-close" title="닫기(Esc)">✕</button>
    </div>
    <div class="edp-body"><div class="edp-load">편집기를 불러오는 중…</div></div>`;
  document.body.appendChild(edBox);
  edBox.querySelector(".edp-close").addEventListener("click", () => closeEditor());
  edBox.querySelector(".edp-tabs").addEventListener("click", (e) => {
    const x = e.target.closest("[data-close]");
    if (x) return edCloseTab(x.dataset.close);
    const t = e.target.closest("[data-path]");
    if (t) edShow(t.dataset.path);
  });
  // Monaco 가 Esc 를 먼저 처리할 수 있어 캡처 단계에서 닫는다.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && edBox && edBox.classList.contains("open")) closeEditor();
  }, true);
}

function closeEditor() {
  if (edBox) edBox.classList.remove("open");
}

function edPaintTabs() {
  if (!edBox) return;
  edEl(".edp-tabs").innerHTML = [...ED_TABS.entries()].map(([p, t]) =>
    `<div class="edp-tab${p === edActive ? " on" : ""}${t.dirty ? " dirty" : ""}" data-path="${esc(p)}" title="${esc(p)}">${esc(String(p).split(/[\\/]/).pop())}<b data-close="${esc(p)}" title="탭 닫기">×</b></div>`).join("");
  edEl(".edp-path").textContent = edActive || "";
}

function edShow(path) {
  const t = ED_TABS.get(path);
  if (!t || !edEditor) return;
  const prev = edActive && ED_TABS.get(edActive);
  if (prev && prev !== t) prev.view = edEditor.saveViewState();
  edActive = path;
  edEditor.setModel(t.model);
  if (t.view) edEditor.restoreViewState(t.view);
  edEditor.focus();
  edPaintTabs();
  edSetMsg(t.dirty ? "수정됨" : "저장됨", t.dirty ? "dirty" : "");
  edCount();
  edScheduleDiag();
}

function edAddModel(monaco, path, text, mtime) {
  const t = ED_TABS.get(path);
  if (t) {
    if (!t.dirty) {
      if (t.model.getValue() !== text) t.model.setValue(text);
      t.mtime = mtime;
      t.dirty = false;
    }
    return t;
  }
  const model = monaco.editor.createModel(text, edLang(path), monaco.Uri.file(path));
  const item = { model, mtime, dirty: false, view: null };
  ED_TABS.set(path, item);
  return item;
}

function edStart(monaco) {
  if (edEditor) return;
  const body = edEl(".edp-body");
  body.innerHTML = "";
  edEditor = monaco.editor.create(body, {
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
  });
  edEditor.onDidChangeModelContent(() => edChanged());
  edEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => edSave());
  // Python 은 우리 LSP 로, JS/TS 는 Monaco 내장 TypeScript 서비스로 정의를 찾는다.
  edEditor.addCommand(monaco.KeyCode.F12, () => {
    const m = edEditor.getModel();
    const lang = m && m.getLanguageId();
    if (lang === "python" || lang === "javascript" || lang === "typescript") edGoto();
  });
  // Ctrl+클릭 정의 이동(Python). JS/TS 는 Monaco 내장 링크가 같은 일을 한다.
  edEditor.onMouseDown((e) => {
    const t = edActive && ED_TABS.get(edActive);
    if (!t || !e.target.position || !(e.event.ctrlKey || e.event.metaKey)) return;
    if (t.model.getLanguageId() === "python") edGoto();
  });
  monaco.editor.onDidChangeMarkers(() => edCount());
}

function edCloseTab(path) {
  const t = ED_TABS.get(path);
  if (!t) return;
  if (t.dirty && !confirm(`'${path}' 의 변경을 저장하지 않았습니다. 닫을까요?`)) return;
  if (edActive === path) {
    edEditor.setModel(null);
    edActive = null;
  }
  t.model.dispose();
  ED_TABS.delete(path);
  edPaintTabs();
  const next = [...ED_TABS.keys()].pop();
  if (next) edShow(next);
  else closeEditor();
}

async function edOpenAt(path, line, character) {
  if (!ED_TABS.has(path)) {
    const r = await edRead(path);
    if (!r.ok) return edSetMsg(r.error || "파일을 열 수 없습니다", "bad");
    edAddModel(await loadMonaco(), path, r.text, r.mtime);
  }
  edShow(path);
  const pos = { lineNumber: line + 1, column: character + 1 };
  edEditor.setPosition(pos);
  edEditor.revealPositionInCenter(pos);
  edEditor.focus();
  edSetMsg("정의로 이동: " + String(path).split(/[\\/]/).pop() + ":" + (line + 1));
}

async function openEditor(path) {
  edEnsurePanel();
  edBox.classList.add("open");
  edSetMsg("불러오는 중…");
  edLspStatus().then((s) => {
    const el = edEl(".edp-lsp");
    if (el) el.textContent = s.pyright ? "" : "Python 언어 서버 없음";
  });
  try {
    const [monaco, r] = await Promise.all([loadMonaco(), edRead(path)]);
    if (!r.ok) throw new Error(r.error || "파일을 열 수 없습니다");
    edStart(monaco);
    edAddModel(monaco, path, r.text, r.mtime);
    edShow(path);
  } catch (e) {
    const msg = e.message || String(e);
    edSetMsg(msg, "bad");
    if (!edEditor) {
      const body = edEl(".edp-body");
      if (body) body.innerHTML = `<div class="edp-load bad">${esc(msg)}</div>`;
    }
  }
}
