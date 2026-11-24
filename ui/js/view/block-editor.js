/* omp-live-map · view · editor 블록 (카드 안 VS Code형 편집기: 탐색기 사이드바 + 탭 + Monaco + 상태바, 기본 펼침) */

// 마크업은 빈 슬롯뿐이다. 편집기 DOM(root)은 editor.js 의 카드 상태가 가지고 있다가 바디가 새로 만들어질 때마다 다시 붙인다.
function editorBlock() {
  return '<div class="edslot"></div>';
}

function attachEditor(box, n) {
  const fresh = !ED.has(n.id);
  const s = edState(n.id);
  const slot = box.querySelector(".edslot");
  if (s.root.parentNode !== slot) slot.appendChild(s.root);
  if (fresh || !TREES.has(n.id)) loadTree(n.id, exCwd(n.id));   // 카드를 열 때마다 다시 읽는다(닫아 둔 사이 바뀐 파일이 보이도록)
  else exPaint(s);
  if (s.editor) {
    s.editor.layout();
    if (s.focus) s.editor.focus();   // 바디 재생성으로 잃은 포커스(커서는 Monaco 가 유지)
  } else if (s.active) void edResume(s);
}

// 바디가 유지된 채 스냅샷만 바뀐 경우에는 편집기 DOM·커서·포커스를 건드리지 않는다(paint 없음).
registerBlock({ type: "editor", slot: "main", flex: 2, render: editorBlock, mount: attachEditor, onRemove: edDispose });
