/* omp-live-map · view · 편집기 탐색기 사이드바: 세션 cwd 기준 파일 트리(지연 로드·필터·우클릭 메뉴). 데이터는 viewmodel/files.js 의 TREES */

// 아이콘은 explorer.css 의 .ic (SVG 마스크)가 그린다. 파일은 확장자로 색을 고른다.
function fileIcon(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return `<i class="ic" data-ext="${m ? esc(m[1].toLowerCase()) : ""}"></i>`;
}

// 트리 루트 기준 상대 경로(소문자)로 거른다. 폴더는 자기 경로가 맞으면 통째로, 아니면 맞는 자식만 남긴다.
function filterTree(entries, q, root) {
  const rel = (p) => {
    const s = String(p || "").replace(/\\/g, "/");
    return (s.startsWith(root) ? s.slice(root.length) : s).toLowerCase();
  };
  const out = [];
  for (const e of entries) {
    const hit = rel(e.path).includes(q);
    if (e.dir) {
      const kids = filterTree(e.children || [], q, root);
      if (hit || kids.length) out.push({ ...e, children: hit ? e.children : kids });
    } else if (hit) {
      out.push(e);
    }
  }
  return out;
}

// 보이는 행을 평평하게 만든다. children 이 없는 폴더는 아직 안 읽은 것(펼칠 때 마저 읽는다).
function exRows(entries, depth, s, all, out) {
  for (const e of entries) {
    const pad = `style="padding-left:${6 + depth * 8}px"`;
    const sel = e.path === s.active ? " sel" : "";
    if (!e.dir) {
      out.push(`<div class="exr${sel}" data-file="${esc(e.path)}" title="${esc(e.path)}" ${pad}><i class="exc"></i>${fileIcon(e.name)}<span class="exn">${esc(e.name)}</span></div>`);
      continue;
    }
    const loaded = e.children !== undefined;
    const open = s.exp.has(e.path) || (all && loaded);
    out.push(`<div class="exr dir${open ? " open" : ""}" data-dir="${esc(e.path)}" title="${esc(e.path)}" ${pad}><i class="exc"></i><i class="ic d"></i><span class="exn">${esc(e.name)}</span></div>`);
    if (!open) continue;
    if (!loaded) out.push(`<div class="exm" style="padding-left:${30 + depth * 8}px">불러오는 중…</div>`);
    else if (!e.children.length) out.push(`<div class="exm" style="padding-left:${30 + depth * 8}px">(빈 폴더)</div>`);
    else exRows(e.children, depth + 1, s, all, out);
  }
}

// viewmodel/files.js 가 데이터를 바꿀 때마다 부른다.
function paintTree(id) {
  const s = ED.get(id);
  if (s) exPaint(s);
}

function exPaint(s) {
  const data = TREES.get(s.id);
  const box = edQ(s, ".extree");
  if (!data) return;
  const q = s.fq.trim().toLowerCase();
  const root = String(data.path || "").replace(/\\/g, "/");
  const has = data.entries && data.entries.length;
  const shown = has && q ? filterTree(data.entries, q, root) : data.entries;
  const rows = [];
  if (data.loading) rows.push('<div class="exm">불러오는 중…</div>');
  else if (shown && shown.length) exRows(shown, 0, s, !!q, rows);
  else rows.push(`<div class="exm">${esc(q && has ? "(일치 없음)" : data.error || "표시할 파일 없음")}</div>`);
  box.innerHTML = rows.join("");
  const r = edQ(s, ".edroot");
  r.textContent = edBase(data.path || "") || data.path || "";
  r.title = data.path || "";
  edQ(s, '[data-ex="up"]').disabled = !parentDir(data.path);
  edQ(s, '[data-ex="reload"]').classList.toggle("busy", !!data.loading);
  edPaintCrumb(s);
}

// 열린 파일 행 강조만 다시 맞춘다(트리를 다시 그리지 않아 스크롤·펼침이 그대로).
function exSelect(s) {
  for (const r of s.root.querySelectorAll(".exr[data-file]")) r.classList.toggle("sel", r.dataset.file === s.active);
}

function exCwd(id) {
  const n = nodeById(id);
  const st = n && termState(n);
  return (st && st.cwd) || (n && n.cwd) || "";
}

// 복사 결과는 상태바에 알린다(행 글자를 바꾸면 아이콘이 지워진다).
function exCopy(s, text) {
  const done = (msg, cls) => edSetMsg(s, msg, cls);
  if (!navigator.clipboard) return done("복사 실패", "bad");
  navigator.clipboard.writeText(String(text)).then(() => done("복사됨: " + text), () => done("복사 실패", "bad"));
}

function exMenu(s, e, p, isFile) {
  const items = [];
  if (isFile) items.push({ label: "열기", hint: "더블클릭", run: () => openEditor(s.id, p, { pin: true }) });
  items.push({ label: "경로 복사(절대경로)", title: p, run: () => exCopy(s, p) });
  items.push({ label: "이름 복사", title: edBase(p), run: () => exCopy(s, edBase(p)) });
  items.push(null);
  items.push({ label: isFile ? "터미널 cwd를 이 파일의 폴더로" : "터미널 cwd를 이 폴더로", run: () => setCwd(s.id, p, isFile) });
  showMenu(e.clientX, e.clientY, items);
}

function edWireExplorer(s) {
  const id = s.id;
  const fq = edQ(s, ".edfq");
  fq.addEventListener("input", () => { s.fq = fq.value; exPaint(s); });
  fq.addEventListener("keydown", (e) => { if (e.key === "Escape") { fq.value = ""; s.fq = ""; exPaint(s); } });
  edQ(s, ".edside-h").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ex]");
    if (!b || b.disabled) return;
    const data = TREES.get(id);
    if (b.dataset.ex === "reload") loadTree(id, (data && data.path) || exCwd(id));
    else if (b.dataset.ex === "up" && data) setCwd(id, parentDir(data.path), false);
    else if (b.dataset.ex === "collapse") { s.exp.clear(); exPaint(s); }
  });
  const tree = edQ(s, ".extree");
  // 폴더 클릭 = 펼침/접힘(안 읽은 폴더는 마저 읽는다). 파일 클릭 = 미리보기 탭, 더블클릭(detail 2) = 탭 고정.
  tree.addEventListener("click", (e) => {
    const row = e.target.closest(".exr");
    if (!row) return;
    if (row.dataset.dir) {
      const p = row.dataset.dir;
      if (s.exp.has(p)) s.exp.delete(p); else { s.exp.add(p); loadTreeChildren(id, p); }
      return exPaint(s);
    }
    openEditor(id, row.dataset.file, { pin: e.detail > 1 });
  });
  // 우클릭: 카드 메뉴로 번지지 않게 막고 탐색기 메뉴를 띄운다.
  tree.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".exr");
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    exMenu(s, e, row.dataset.file || row.dataset.dir, !!row.dataset.file);
  });
  edQ(s, ".edroot").addEventListener("contextmenu", (e) => {
    const data = TREES.get(id);
    if (!data || !data.path) return;
    e.preventDefault();
    e.stopPropagation();
    exMenu(s, e, data.path, false);
  });
}
