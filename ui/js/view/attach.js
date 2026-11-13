/* omp-live-map · view · 첨부 칩과 붙여넣기·끌어 놓기 연결 (채팅 블록·새 세션 창 공용) */

const attachSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : n >= 1024 ? Math.round(n / 1024) + "KB" : n + "B");

function attachChipsHTML(list) {
  return list.map((it) => {
    const ext = (/\.([^.]{1,5})$/.exec(it.name) || [, "file"])[1].toUpperCase();
    const note = it.err || (it.reading ? "읽는 중…" : attachSize(it.size));
    return `<span class="achip${it.err ? " err" : ""}" title="${esc(it.name)} · ${esc(note)}">`
      + (it.url ? `<img src="${esc(it.url)}" alt="">` : `<span class="aext">${esc(ext)}</span>`)
      + `<span class="anm">${esc(it.name)}</span><span class="asz">${esc(note)}</span>`
      + `<button class="ax" data-unattach="${it.id}" title="첨부 빼기">×</button></span>`;
  }).join("");
}

// 칩을 다시 그린다. 같은 마크업이면 건드리지 않아 썸네일이 깜박이지 않는다.
function paintAttachChips(el, list) {
  const html = attachChipsHTML(list);
  if (el.__html !== html) { el.__html = html; el.innerHTML = html; }
}

// zone 안의 붙여넣기(파일만 있을 때)·파일 끌어 놓기·칩 × 를 list 에 반영하고 onChange 를 부른다.
// 글이 함께 실린 붙여넣기(엑셀·웹 문서 복사 등)는 기존처럼 글만 붙인다.
function wireAttach(zone, getList, onChange) {
  zone.addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    if (!cd || !cd.files.length || [...cd.types].includes("text/plain")) return;
    e.preventDefault();
    addAttachments(getList(), cd.files, onChange);
  });
  const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  zone.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    zone.classList.add("dropping");
  });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("dropping"); });
  zone.addEventListener("drop", (e) => {
    zone.classList.remove("dropping");
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    addAttachments(getList(), e.dataTransfer.files, onChange);
  });
  zone.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-unattach]");
    if (!b) return;
    removeAttachment(getList(), +b.dataset.unattach);
    onChange();
  });
}
