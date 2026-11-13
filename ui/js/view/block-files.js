/* omp-live-map · view · files 블록 (터미널 cwd 기준 파일 트리) */

// opened: 사용자가 펼쳐 둔 폴더 경로 Set. all: 필터 중이라 읽어 온 폴더를 모두 펼친다.
// children 이 없는 폴더는 아직 안 읽은 것이다(서버는 두 단계까지만 준다). 펼칠 때 마저 읽는다.
// 아이콘은 panel.css 의 .tree .ic (SVG 마스크) 가 그린다. 파일은 확장자로 색을 고른다.
function fileIcon(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return `<i class="ic" data-ext="${m ? esc(m[1].toLowerCase()) : ""}"></i>`;
}

function treeNodes(entries, opened, all) {
  return entries.map((e) => {
    if (!e.dir) return `<div class="f" data-file="${esc(e.path)}" title="${esc(e.path)}\n클릭: 이 파일의 폴더로 이동 · 더블클릭: 이름 복사">${fileIcon(e.name)}${esc(e.name)}</div>`;
    const loaded = e.children !== undefined;
    const open = opened.has(e.path) || (all && loaded);
    const kids = !loaded ? '<div class="n">불러오는 중…</div>'
      : e.children.length ? treeNodes(e.children, opened, all) : '<div class="n">(빈 폴더)</div>';
    return `<details${open ? " open" : ""}><summary data-dir="${esc(e.path)}" title="클릭: 펼치기 · 더블클릭: 이 폴더로 이동"><i class="ic d"></i>${esc(e.name)}</summary>
        ${kids}</details>`;
  }).join("");
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

function paintTree(id) {
  const el = ELS.get(id);
  const data = TREES.get(id);
  const box = el && el.querySelector(".tree");
  if (!box || !data) return;
  const st = TERM.get(id) || {};
  const q = (st.fq || "").trim().toLowerCase();
  const root = String(data.path || "").replace(/\\/g, "/");
  const has = data.entries && data.entries.length;
  const shown = has && q ? filterTree(data.entries, q, root) : data.entries;
  const up = !data.loading && parentDir(data.path)
    ? `<div class="f up" data-up="${esc(parentDir(data.path))}" title="상위 폴더로 이동"><i class="ic d"></i>‥</div>` : "";
  box.innerHTML = data.loading
    ? '<div class="n">불러오는 중…</div>'
    : up + (shown && shown.length
      ? treeNodes(shown, st.fopen || new Set(), !!q)
      : `<div class="n">${esc(q && has ? "(일치 없음)" : data.error || "표시할 파일 없음")}</div>`);
  const head = el.querySelector(".col-tree .tt .p");
  if (head) head.textContent = data.path || "";
  const rb = el.querySelector("[data-reload-tree]");
  if (rb) rb.classList.toggle("busy", !!data.loading);
}

function filesBlock(n) {
  const st = termState(n);
  return `<div class="tt"><span>files</span><span class="p">${esc(st.cwd || n.cwd || "")}</span>
      <button data-reload-tree="1" title="새로고침" style="padding:0 6px;font-size:10px">↻</button></div>
    <input class="fq" autocomplete="off" spellcheck="false" placeholder="경로 필터" value="${esc(st.fq || "")}">
    <div class="tree"></div>`;
}

function mountFiles(box, n) {
  const id = n.id;
  const st = termState(n);
  const cwd = () => st.cwd || n.cwd || "";
  const fq = box.querySelector(".fq");
  fq.addEventListener("input", () => { st.fq = fq.value; paintTree(id); });
  fq.addEventListener("keydown", (e) => { if (e.key === "Escape") { fq.value = ""; st.fq = ""; paintTree(id); } });
  box.querySelector("[data-reload-tree]").addEventListener("click", () => loadTree(id, cwd()));
  const tree = box.querySelector(".tree");
  // toggle 은 버블링하지 않아 캡처로 받는다. 펼친 폴더를 기억해 두고, 아직 안 읽은 폴더면 마저 읽는다.
  tree.addEventListener("toggle", (e) => {
    const sum = e.target.querySelector(":scope > summary[data-dir]");
    if (!sum) return;
    const opened = st.fopen || (st.fopen = new Set());
    if (!e.target.open) { if (!st.fq) opened.delete(sum.dataset.dir); return; }
    if (!st.fq) opened.add(sum.dataset.dir);
    loadTreeChildren(id, sum.dataset.dir);
  }, true);
  // 파일 한 번 클릭 = 그 폴더로 cwd 이동(더블클릭과 구분하려고 잠깐 미룸), 더블클릭 = 파일명 복사.
  let timer = null;
  tree.addEventListener("click", (e) => {
    const up = e.target.closest(".f[data-up]");
    if (up) return setCwd(id, up.dataset.up, false);
    const f = e.target.closest(".f[data-file]");
    if (!f) return;
    clearTimeout(timer);
    if (e.detail > 1) return;
    timer = setTimeout(() => setCwd(id, f.dataset.file, true), 260);
  });
  tree.addEventListener("dblclick", (e) => {
    clearTimeout(timer);
    const dir = e.target.closest("summary[data-dir]");
    if (dir) return setCwd(id, dir.dataset.dir, false);
    const f = e.target.closest(".f[data-file]");
    if (f) copyText(f.dataset.orig || f.textContent, f);
  });
  // 카드를 열 때마다 다시 읽는다(닫아 둔 사이 바뀐 파일이 보이도록).
  loadTree(id, cwd());
}

registerBlock({ type: "files", slot: "side", render: filesBlock, mount: mountFiles });
