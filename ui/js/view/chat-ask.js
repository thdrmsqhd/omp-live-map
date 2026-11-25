/* omp-live-map · view · 대화 블록의 질문 카드(ask·select·confirm·input·editor) */

const ASK_LABEL = { ask: "질문", select: "선택", confirm: "확인", input: "입력", editor: "편집" };

// 카드 헤더·작은 카드에 붙는 "답 대기" 표시.
function askBadge(id) {
  return askPending(id) ? `<span class="cask-badge" title="에이전트가 답을 기다립니다">답 대기</span>` : "";
}

function askOptHTML(r, o, oi, qi) {
  const on = qi == null ? r._sel.has(oi) : r.questions[qi]._sel.has(o.label);
  const multi = qi == null ? r.selectionMarker === "checkbox" : r.questions[qi].multi;
  const rec = qi != null && r.questions[qi].recommended === oi ? '<span class="cask-rec">추천</span>' : "";
  const attr = qi == null ? `data-ask-sel="${oi}"` : `data-ask-opt="${qi}" data-ask-label="${esc(o.label)}"`;
  return `<label class="cask-o${on ? " on" : ""}">
    <input type="${multi ? "checkbox" : "radio"}" name="ask-${esc(r.id)}-${qi ?? "s"}"${on ? " checked" : ""} ${attr}>
    <span class="cask-l">${esc(o.label)}</span>${rec}
    ${(o.desc||o.description)?`<span class="cask-d">${esc(o.desc||o.description)}</span>`:""}</label>`;
}

function askQuestionHTML(r, q, qi) {
  const opts = (q.options || []).map((o, oi) => askOptHTML(r, o, oi, qi)).join("");
  return `<div class="cask-q">
    ${q.header ? `<div class="cask-qt">${esc(q.header)}</div>` : ""}
    <div class="cask-qu">${esc(q.question)}</div>
    <div class="cask-os">${opts}</div>
    <input class="cask-in" data-ask-field="c${qi}" data-ask-custom="${qi}" placeholder="직접 입력 (고른 항목 대신)" autocomplete="off">
  </div>`;
}

function askBodyHTML(r) {
  if (r.method === "ask") return (r.questions || []).map((q, qi) => askQuestionHTML(r, q, qi)).join("");
  if (r.method === "select") {
    if (typeof askCheckboxForm === "function" && askCheckboxForm(r)) {
      // 체크박스는 누를 때마다 label 하나를 보내고 omp 가 다시 묻는다. markableCount 이상은 Done 이라 버튼으로 뺀다.
      const opts = r.options.slice(0, r.markableCount)
        .map((label, i) => askOptHTML(r, { label, desc: (r.optionDetails[i] || {}).description || "" }, i, null)).join("");
      const done = askDoneIndex(r);
      return `<div class="cask-q"><div class="cask-qu">${esc(r.title)}</div><div class="cask-os">${opts}</div>
        <div class="cask-f">${done >= 0 ? `<button class="go" data-ask-send="1" title="${esc(r.options[done])}">선택 완료</button>` : ""}
        <span class="cask-d">누를 때마다 바로 전송 · 여러 개는 이어서</span></div></div>`;
    }
    const opts = r.options.map((label, i) => askOptHTML(r, { label, desc: (r.optionDetails[i] || {}).description || "" }, i, null)).join("");
    return `<div class="cask-q"><div class="cask-qu">${esc(r.title)}</div><div class="cask-os">${opts}</div></div>`;
  }
  if (r.method === "confirm") {
    return `<div class="cask-q"><div class="cask-qu">${esc(r.message || r.title)}</div>
      <div class="cask-f"><button class="go" data-ask-confirm="1">승인</button><button data-ask-confirm="0">거부</button></div></div>`;
  }
  if (r.method === "editor") {
    return `<div class="cask-q"><div class="cask-qu">${esc(r.title)}</div>
      <textarea class="cask-ta" rows="4" data-ask-field="v" data-ask-value="1"></textarea></div>`;
  }
  return `<div class="cask-q"><div class="cask-qu">${esc(r.title)}</div>
    <input class="cask-in" type="${r.secret ? "password" : "text"}" data-ask-field="v" data-ask-value="1" placeholder="${esc(r.placeholder)}" autocomplete="off"></div>`;
}

function askCardHTML(r, i) {
  const title = r.method === "ask" ? `${(r.questions || []).length}개 질문` : r.title;
  const foot = r.method === "confirm" ? "" : `<div class="cask-f"><button data-ask-send="1">보내기</button><button data-ask-cancel="1">취소</button>
    ${r._err ? `<span class="cask-err">${esc(r._err)}</span>` : ""}</div>`;
  return `<div class="cask${r._sending ? " sending" : ""}" data-ask-card="${i}">
    <div class="cask-h"><span class="cask-k">${ASK_LABEL[r.method] || "질문"}</span><span class="cask-t">${esc(title)}</span>
      <button class="cask-x" data-ask-cancel="1" title="질문 닫기">✕</button></div>
    ${askBodyHTML(r)}${foot}</div>`;
}

// 텍스트 입력값은 상태(_custom·_value)에 있고, 마크업에는 넣지 않는다(글자를 칠 때마다 다시 그리지 않게).
function syncAskFields(host, list) {
  const cards = host.querySelectorAll("[data-ask-card]");
  list.forEach((r, i) => {
    const card = cards[i];
    if (!card) return;
    for (const el of card.querySelectorAll("[data-ask-field]")) {
      const key = el.dataset.askField;
      let v = "";
      if (key === "v") v = r._value || "";
      else {
        const q = (r.questions || [])[+key.slice(1)];
        v = (q && q._custom) || "";
      }
      if (el.value !== v) el.value = v;
    }
  });
}

// 대화 블록의 .casks 만 갱신한다. 질문 구성·고른 항목이 그대로면 DOM 을 건드리지 않는다.
function paintChatAsk(box, id) {
  const host = box.querySelector(".casks");
  if (!host) return;
  const list = asksOf(id);
  const html = list.map(askCardHTML).join("");
  if (host.__html !== html) {
    const top = host.scrollTop;
    const act = document.activeElement;
    const card = act && host.contains(act) ? act.closest("[data-ask-card]") : null;
    const field = card && act.dataset ? act.dataset.askField : "";
    let sel = null;
    if (field) { try { sel = [act.selectionStart, act.selectionEnd]; } catch {} }
    host.__html = html;
    host.innerHTML = html;
    // 카드가 늘거나 줄 때 브라우저가 스크롤을 옮기지 않게 직접 되돌린다.
    host.scrollTop = top;
    if (field && card) {
      const next = host.querySelector(`[data-ask-card="${card.dataset.askCard}"] [data-ask-field="${field}"]`);
      if (next) {
        next.focus();
        if (sel) { try { next.setSelectionRange(sel[0], sel[1]); } catch {} }
      }
    }
  }
  syncAskFields(host, list);
}

function mountChatAsk(box) {
  const host = box.querySelector(".casks");
  if (!host || host.dataset.wired) return;
  host.dataset.wired = "1";
  const cardOf = (el) => {
    const card = el.closest("[data-ask-card]");
    const id = box.closest(".node") ? box.closest(".node").dataset.id : "";
    const r = card ? asksOf(id)[+card.dataset.askCard] : null;
    return r ? { id, r } : null;
  };
  host.addEventListener("change", (e) => {
    const el = e.target;
    const hit = cardOf(el);
    if (!hit) return;
    if (el.dataset.askOpt != null) askPick(hit.id, hit.r.id, +el.dataset.askOpt, el.dataset.askLabel);
    else if (el.dataset.askSel != null) askSelect(hit.id, hit.r.id, +el.dataset.askSel);
  });
  host.addEventListener("input", (e) => {
    const el = e.target;
    const hit = cardOf(el);
    if (!hit || el.dataset.askCustom == null && el.dataset.askValue == null) return;
    if (el.dataset.askCustom != null) askCustom(hit.id, hit.r.id, +el.dataset.askCustom, el.value);
    else askValue(hit.id, hit.r.id, el.value);
  });
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    const hit = cardOf(e.target);
    if (!hit) return;
    e.preventDefault();
    if (hit.r.method === "confirm") askConfirm(hit.id, hit.r.id, true);
    else askSend(hit.id, hit.r.id);
  });
  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    const hit = cardOf(e.target);
    if (!btn || !hit) return;
    if (btn.dataset.askSend != null) askSend(hit.id, hit.r.id);
    else if (btn.dataset.askCancel != null) askCancel(hit.id, hit.r.id);
    else if (btn.dataset.askConfirm != null) askConfirm(hit.id, hit.r.id, btn.dataset.askConfirm === "1");
  });
}
