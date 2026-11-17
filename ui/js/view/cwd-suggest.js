/* omp-live-map · view · 새 세션 창 작업 폴더 자동완성 (부모 폴더 하위·최근·세션 폴더) */

const CWD_RECENT_KEY = "omp-cwd-recent";

function cwdRecent() {
  return strList(readJSON(CWD_RECENT_KEY, [])).slice(0, 8);
}

// 세션 열기에 성공한 폴더를 최근 목록 맨 앞에 남긴다(중복은 대소문자 무시).
function rememberCwd(dir) {
  const v = String(dir || "").trim();
  if (!v) return;
  writeJSON(CWD_RECENT_KEY, [v, ...cwdRecent().filter((d) => d.toLowerCase() !== v.toLowerCase())].slice(0, 8));
}

// 경로를 마지막 구분자 기준으로 부모와 조각으로 나눈다. "/"와 "\", "C:" 드라이브를 함께 다룬다.
function cwdParts(v) {
  const i = Math.max(v.lastIndexOf("/"), v.lastIndexOf("\\"));
  if (i >= 0) return { base: v.slice(0, i + 1), part: v.slice(i + 1) };
  if (/^[a-zA-Z]:$/.test(v)) return { base: v + "/", part: "" };
  return { base: "", part: v };
}

// 끝 구분자를 지운다(드라이브 루트 "C:/"는 남긴다).
const cwdTrim = (p) => (/^[a-zA-Z]:\/$/.test(p) ? p : p.replace(/[\\/]+$/, ""));

const cwdName = (p) => cwdTrim(p).split(/[\\/]/).filter(Boolean).pop() || p;

// "C:/" 같은 드라이브 루트는 끝 구분자를 이미 갖고 있다.
const cwdJoin = (base, sep, name) => {
  const head = cwdTrim(base);
  return (head.endsWith("/") || head.endsWith("\\") ? head : head + sep) + name;
};

// 지금 맵에 있는 세션들의 작업 폴더.
function cwdSessions() {
  const isPath = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/");
  return (DATA.sessions || []).flatMap((s) =>
    [s.folder, ...(s.nodes || []).map((n) => n.cwd)].filter((p) => isPath(String(p || ""))));
}

const cwdTree = (p) =>
  fetch("/api/tree?p=" + encodeURIComponent(p) + "&d=1")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

function installCwdSuggest(box, cwd) {
  let rows = [];          // 지금 드롭다운의 선택 가능한 행
  let sel = -1;
  let seq = 0, exSeq = 0, timer = 0;
  const cache = new Map();

  const warn = Object.assign(document.createElement("div"), { className: "cwdwarn" });
  cwd.insertAdjacentElement("afterend", warn);

  const pop = Object.assign(document.createElement("div"), { className: "cwdpop", hidden: true });
  cwd.closest("label").appendChild(pop);

  const closePop = () => { pop.hidden = true; pop.textContent = ""; rows = []; sel = -1; };

  // 창이 움직여도 입력 바로 아래에 붙도록 매번 위치를 잰다.
  function place() {
    const r = cwd.getBoundingClientRect();
    Object.assign(pop.style, { left: r.left + "px", top: r.bottom + 2 + "px", width: r.width + "px" });
  }

  function mark() {
    rows.forEach((it, i) => it.el.classList.toggle("on", i === sel));
    if (sel >= 0 && rows[sel]) rows[sel].el.scrollIntoView({ block: "nearest" });
  }

  function render(list) {
    pop.textContent = "";
    rows = [];
    sel = -1;
    let head = "";
    const frag = document.createDocumentFragment();
    for (const it of list) {
      if (it.head && it.head !== head) {
        head = it.head;
        const h = document.createElement("div");
        h.className = "cdh";
        h.textContent = head;
        frag.appendChild(h);
      }
      const el = document.createElement("div");
      el.className = "cdi";
      el.innerHTML = `<span class="cdn">${esc(it.name)}</span><span class="cdp">${esc(it.path)}</span>`;
      // mousedown에서 포커스를 빼앗기지 않게 막고 바로 채택한다.
      el.addEventListener("mousedown", (e) => { e.preventDefault(); adopt(it); });
      frag.appendChild(el);
      rows.push({ ...it, el });
    }
    pop.appendChild(frag);
    sel = rows.length ? 0 : -1;
    pop.hidden = !rows.length;
    if (rows.length) { place(); mark(); }
  }

  async function listPath(v) {
    const { base, part } = cwdParts(v);
    if (!base) { seq++; closePop(); return; }
    const my = ++seq;
    const parent = cwdTrim(base);
    const key = parent.toLowerCase();
    let data = cache.get(key);
    if (!data) {
      data = await cwdTree(parent);
      if (data) cache.set(key, data);
    }
    // 그 사이 입력이 바뀌었거나 창을 닫았으면 이 응답은 버린다.
    if (my !== seq || !box.isConnected || cwd.value !== v) return;
    const sep = base.slice(-1) === "\\" ? "\\" : "/";
    const low = part.toLowerCase();
    const list = ((data && data.entries) || [])
      .filter((e) => e.dir && e.name.toLowerCase().startsWith(low) && e.name.toLowerCase() !== low)
      .slice(0, 12)
      .map((e) => ({ name: e.name, path: cwdJoin(base, sep, e.name), sep, kind: "dir" }));
    if (list.length) render(list); else closePop();
  }

  // 입력이 비었거나 포커스했을 때: 최근 폴더 → 지금 세션 폴더.
  function quick() {
    const seen = new Set();
    const out = [];
    const add = (p, head) => {
      const v = String(p || "").trim();
      const k = v.toLowerCase();
      if (!v || seen.has(k)) return;
      seen.add(k);
      out.push({ name: cwdName(v), path: v, sep: v.includes("\\") ? "\\" : "/", kind: "quick", head });
    };
    for (const p of cwdRecent()) add(p, "최근 폴더");
    for (const p of cwdSessions()) add(p, "세션 폴더");
    if (out.length) render(out.slice(0, 12)); else closePop();
  }

  function adopt(it) {
    // 고른 뒤 이전 후보가 남아 있으면 ↑↓·Enter 가 엉뚱한 행을 집으므로 바로 비운다.
    closePop();
    cwd.value = it.kind === "dir" ? it.path + it.sep : it.path;
    cwd.focus();
    checkExists(cwd.value);
    if (it.kind === "dir") listPath(cwd.value);
  }

  // 없는 폴더면 입력 아래에 알린다(전송은 서버 기존 동작에 맡긴다).
  function checkExists(v) {
    const p = cwdTrim(String(v || "").trim());
    const my = ++exSeq;
    if (!p) { warn.textContent = ""; return; }
    cwdTree(p).then((data) => {
      if (my !== exSeq || !box.isConnected) return;
      if (cwdTrim(cwd.value.trim()).toLowerCase() !== p.toLowerCase()) return;
      warn.textContent = data && data.exists === false ? "없는 폴더입니다. 이대로 열면 '폴더 없음' 오류가 납니다." : "";
    });
  }

  cwd.addEventListener("input", () => {
    clearTimeout(timer);
    // 방금 친 글자와 맞지 않는 예전 후보를 남겨 두면 Enter 가 그 행을 집는다.
    closePop();
    const v = cwd.value;
    timer = setTimeout(() => {
      if (!box.isConnected) return;
      const t = v.trim();
      if (t) listPath(v); else quick();
      checkExists(t);
    }, 160);
  });
  // 포커스하면 최근·세션 폴더를 먼저 보여 주고, 입력을 시작하면 경로 후보로 바뀐다.
  cwd.addEventListener("focus", () => { clearTimeout(timer); quick(); });
  cwd.addEventListener("click", () => { if (pop.hidden && !cwd.value.trim()) quick(); });
  cwd.addEventListener("blur", () => closePop());

  // 새 세션 창의 전역 키 처리(document 캡처)에서 먼저 불린다.
  box.__sugKey = (e) => {
    if (pop.hidden) return false;
    if (e.key === "Escape") { closePop(); e.preventDefault(); e.stopPropagation(); return true; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return false;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      mark(); e.preventDefault(); e.stopPropagation();
      return true;
    }
    if ((e.key === "Tab" || e.key === "Enter") && !e.ctrlKey && !e.metaKey) {
      const it = rows[sel];
      if (!it) return false;
      e.preventDefault(); e.stopPropagation();
      adopt(it);
      return true;
    }
    return false;
  };

  if (cwd.value.trim()) checkExists(cwd.value);
}
