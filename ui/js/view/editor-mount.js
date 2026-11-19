/* omp-live-map · view · Monaco(jsDelivr CDN) 지연 로드·언어 매핑·진단 마커 변환 */

const ED_CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/";
let edMonaco = null;
let edMonacoPromise = null;

// 편집기를 처음 열 때만 CDN 에서 받는다(npm 의존성 없음). 실패하면 다음 열기에서 다시 시도한다.
function loadMonaco() {
  if (edMonaco) return Promise.resolve(edMonaco);
  if (edMonacoPromise) return edMonacoPromise;
  edMonacoPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ED_CDN + "vs/loader.js";
    s.onerror = () => { edMonacoPromise = null; reject(new Error("Monaco 로드 실패(CDN 연결 확인)")); };
    s.onload = () => {
      try {
        window.require.config({ paths: { vs: ED_CDN + "vs" } });
        window.require(["vs/editor/editor.main"], () => {
          edMonaco = window.monaco;
          resolve(edMonaco);
        }, (e) => { edMonacoPromise = null; reject(new Error("Monaco 초기화 실패: " + (e && e.message || e))); });
      } catch (e) {
        edMonacoPromise = null;
        reject(e);
      }
    };
    document.head.appendChild(s);
  });
  return edMonacoPromise;
}

const ED_LANG = {
  py: "python", pyw: "python", pyi: "python",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", json: "json",
  css: "css", scss: "scss", less: "less", html: "html", htm: "html",
  md: "markdown", xml: "xml", yml: "yaml", yaml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp",
  java: "java", go: "go", rs: "rust", php: "php", rb: "ruby", sql: "sql",
  toml: "ini", ini: "ini", cfg: "ini", conf: "ini", env: "ini",
};

function edLang(p) {
  const m = /\.([a-z0-9]+)$/i.exec(String(p || ""));
  return (m && ED_LANG[m[1].toLowerCase()]) || "plaintext";
}

// LSP severity(1 오류~4 힌트) → Monaco MarkerSeverity(Error 8, Warning 4, Info 2, Hint 1).
function edMarkers(items) {
  const sev = { 1: 8, 2: 4, 3: 2, 4: 1 };
  return (items || []).map((d) => ({
    severity: sev[d.severity] || 8,
    message: d.message,
    startLineNumber: d.line + 1,
    startColumn: d.character + 1,
    endLineNumber: (d.endLine == null ? d.line : d.endLine) + 1,
    endColumn: (d.endCharacter == null ? d.character : d.endCharacter) + 1,
  }));
}
