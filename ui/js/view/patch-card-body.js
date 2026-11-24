/* 카드 Body의 슬롯과 블록을 키로 조정한다. 이미 마운트된 블록 내부 DOM은 재사용한다. */
function patchCardBody(body, next) {
  const oldBlocks = new Map([...body.querySelectorAll(".blk[data-bkey]")].map((b) => [b.dataset.bkey, b]));
  function syncBlock(old, fresh) {
    old.className = fresh.className;
    old.style.cssText = fresh.style.cssText;
    old.dataset.slot = fresh.dataset.slot;
    const h = old.querySelector(":scope > .bheader"), f = fresh.querySelector(":scope > .bheader");
    if (h && f && h.outerHTML !== f.outerHTML) h.replaceWith(f);
    return old;
  }
  function syncChildren(parent, template) {
    let cursor = parent.firstElementChild;
    for (const fresh of [...template.children]) {
      let el;
      if (fresh.dataset.bkey) {
        const old = oldBlocks.get(fresh.dataset.bkey);
        el = old && old.dataset.blk === fresh.dataset.blk ? syncBlock(old, fresh) : fresh;
      } else {
        const name = fresh.classList[0];
        el = [...parent.children].find((x) => x.classList.contains(name)) || document.createElement(fresh.tagName);
        el.className = fresh.className;
        if (fresh.title) el.title = fresh.title;
        syncChildren(el, fresh);
      }
      if (el !== cursor) {
        if (el.isConnected && parent.isConnected && typeof parent.moveBefore === "function") parent.moveBefore(el,cursor);
        else parent.insertBefore(el,cursor);
      }
      cursor = el.nextElementSibling;
    }
    while (cursor) { const after = cursor.nextElementSibling; cursor.remove(); cursor = after; }
  }
  syncChildren(body, next);
  body.dataset.sig = next.dataset.sig;
}
