/* omp-live-map · view · memo 블록 (카드 메모: 경로·프롬프트 복사·채팅 입력 삽입) */

function memoRowHTML(m) {
  return `<div class="mitem" data-memo-id="${esc(m.id)}">
        <div class="mtext" data-memo-copy="${esc(m.id)}" title="클릭: 복사 · 더블클릭: 수정">${esc(m.text)}</div>
        <div class="macts">
          <button data-memo-insert="${esc(m.id)}" title="채팅 입력창에 넣기">↳</button>
          <button data-memo-edit="${esc(m.id)}" title="수정">✎</button>
          <button data-memo-del="${esc(m.id)}" title="삭제">✕</button>
        </div>
      </div>`;
}

function memoListHTML(id) {
  const list = memoList(id);
  return list.length ? list.map(memoRowHTML).join("") : '<div class="mempty">메모 없음 · + 로 추가</div>';
}

function memoBlock() {
  return `<div class="memo">
      <div class="mtop"><span>memo</span><button data-memo-add="1" title="메모 추가">+</button></div>
      <div class="mlist"></div>
      <div class="mform" hidden>
        <textarea class="minput" spellcheck="false" aria-label="메모" placeholder="메모 (Ctrl+Enter 저장 · Esc 취소)"></textarea>
        <div class="mrow"><button data-memo-save="1">저장</button><button data-memo-cancel="1">취소</button></div>
      </div>
    </div>`;
}

// 목록만 갈아 끼운다(입력 중인 폼과 포커스는 그대로 둔다).
function paintMemo(box, n) {
  const list = box.querySelector(".mlist");
  if (!list) return;
  const html = memoListHTML(n.id);
  if (list.__html === html) return;
  list.__html = html;
  list.innerHTML = html;
}

// 같은 카드의 chat 블록 입력창에 커서 위치에 끼워 넣는다(전송하지 않는다).
function memoInsertToChat(blk, id, text) {
  const card = blk.closest(".node[data-id]");
  const ta = card && card.querySelector(".chat .cin");
  if (!ta) { copyText(text, blk.querySelector("[data-memo-add]")); return; }
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  const pos = s + text.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  // 다음 paint 가 예전 draft 로 되돌리지 않도록 상태도 맞춘다.
  const st = typeof chatState === "function" ? chatState(id) : null;
  if (st) st.draft = ta.value;
  fitChatInput(ta);
}

function mountMemo(blk, n) {
  const id = n.id;
  const box = blk.querySelector(".memo");
  const form = box.querySelector(".mform");
  const input = box.querySelector(".minput");
  let editing = null;

  const closeForm = () => { editing = null; form.hidden = true; input.value = ""; };
  const openForm = (text, itemId) => {
    editing = itemId || null;
    input.value = text || "";
    form.hidden = false;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  const save = () => {
    const text = input.value.trim();
    if (!text) return closeForm();
    if (editing) memoUpdate(id, editing, text); else memoAdd(id, text);
    closeForm();
    paintMemo(box, n);
  };

  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.memoAdd != null) return openForm("");
    if (b.dataset.memoSave != null) return save();
    if (b.dataset.memoCancel != null) return closeForm();
    if (b.dataset.memoInsert != null) {
      const it = memoItem(id, b.dataset.memoInsert);
      if (it) memoInsertToChat(blk, id, it.text);
      return;
    }
    if (b.dataset.memoEdit != null) {
      const it = memoItem(id, b.dataset.memoEdit);
      if (it) openForm(it.text, it.id);
      return;
    }
    if (b.dataset.memoDel != null) { memoRemove(id, b.dataset.memoDel); paintMemo(box, n); }
  });
  // 항목 글 클릭 = 복사(더블클릭 수정과 겹치지 않게 잠깐 미룬다), 더블클릭 = 수정.
  let copyTimer = null;
  const itemAt = (e) => {
    const t = e.target.closest("[data-memo-copy]");
    return t && memoItem(id, t.dataset.memoCopy) ? t : null;
  };
  box.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const t = itemAt(e);
    if (!t) return;
    clearTimeout(copyTimer);
    if (e.detail > 1) return;
    copyTimer = setTimeout(() => {
      const it = t.isConnected && memoItem(id, t.dataset.memoCopy);
      if (it) copyText(it.text, t);
    }, 240);
  });
  box.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    clearTimeout(copyTimer);
    const t = itemAt(e);
    if (t) openForm(memoItem(id, t.dataset.memoCopy).text, t.dataset.memoCopy);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    else if (e.key === "Escape") { e.preventDefault(); closeForm(); }
  });
  paintMemo(box, n);
}

registerBlock({ type: "memo", slot: "side", flex: 1, render: memoBlock, mount: mountMemo, paint: paintMemo });
