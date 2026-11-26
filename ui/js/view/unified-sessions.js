/* Workflow 관제 화면의 세션 스트립. 네트워크를 호출하지 않고, 이미 있는 세션·질문 모델만 읽는다. */
(() => {
  "use strict";

  const root = document.getElementById("unified-sessions");
  if (!root) return;

  const label = document.createElement("h2");
  label.className = "unified-sessions-label";
  label.textContent = "세션 관제";
  const status = document.createElement("p");
  status.className = "unified-sessions-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const list = document.createElement("ul");
  list.className = "unified-sessions-list";
  const asksHost = document.createElement("div");
  asksHost.className = "unified-sessions-asks";
  root.replaceChildren(label, status, list, asksHost);

  let timer = 0;
  let paintQueued = false;

  function sectionVisible() {
    if (!root.isConnected || root.hidden || document.hidden) return false;
    if (document.visibilityState && document.visibilityState !== "visible") return false;
    for (let node = root; node; node = node.parentElement) {
      if (node.hidden) return false;
      try {
        if (typeof getComputedStyle === "function" && getComputedStyle(node).display === "none") return false;
      } catch {}
    }
    return true;
  }
  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }
  function askMarkup(items) {
    return items.map((request, index) => askCardHTML(request, index)).join("");
  }
  function cardsFor(id, items) {
    try {
      if (typeof asksOf === "function") {
        const current = asksOf(id);
        if (Array.isArray(current) && current.length) return current;
      }
    } catch {}
    return items;
  }
  function remember(section, id, items) {
    const listForCards = cardsFor(id, items);
    trackWorkflowAskCards(section, id, listForCards);
    syncAskFields(section, listForCards);
  }
  function paintSessions(sessions) {
    const signature = sessions.map((session) => `${session && session.key}\0${sessionStripTitle(session)}`).join("\n");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren();
    for (const session of sessions) {
      const item = document.createElement("li");
      item.className = "unified-session";
      if (session && session.key != null) item.dataset.sessionKey = String(session.key);
      const title = document.createElement("span");
      title.className = "unified-session-title";
      title.textContent = sessionStripTitle(session);
      item.append(title);
      list.append(item);
    }
  }
  function paintAsks(groups) {
    const signature = JSON.stringify(groups.map((group) => [group.key, group.id, group.list.map((request) => request && request.id), askMarkup(group.list)]));
    if (asksHost.dataset.signature !== signature) {
      const active = document.activeElement;
      const field = active && asksHost.contains(active) && active.dataset ? active.dataset.askField : "";
      const card = field && active.closest("[data-ask-card]");
      const section = card && card.closest("[data-ask-node]");
      const nodeId = section ? section.dataset.askNode : "";
      const cardIndex = card ? card.dataset.askCard : "";
      let selection = null;
      if (field) { try { selection = [active.selectionStart, active.selectionEnd]; } catch {} }
      asksHost.dataset.signature = signature;
      asksHost.replaceChildren();
      for (const group of groups) {
        const sectionEl = document.createElement("section");
        sectionEl.className = "unified-session-ask";
        sectionEl.dataset.askNode = group.id;
        const title = document.createElement("strong");
        title.className = "unified-session-ask-title";
        title.textContent = group.title;
        const form = document.createElement("form");
        form.className = "casks";
        form.innerHTML = askMarkup(group.list);
        sectionEl.append(title, form);
        asksHost.append(sectionEl);
      }
      if (field && nodeId && typeof CSS !== "undefined" && CSS.escape) {
        const next = asksHost.querySelector(`[data-ask-node="${CSS.escape(nodeId)}"] [data-ask-card="${CSS.escape(cardIndex)}"] [data-ask-field="${CSS.escape(field)}"]`);
        if (next) {
          next.focus();
          if (selection) { try { next.setSelectionRange(selection[0], selection[1]); } catch {} }
        }
      }
    }
    for (const sectionEl of asksHost.querySelectorAll("[data-ask-node]")) {
      const group = groups.find((item) => item.id === sectionEl.dataset.askNode);
      remember(sectionEl, sectionEl.dataset.askNode, group ? group.list : []);
    }
    if (typeof updateAskDeadlines === "function") {
      try { updateAskDeadlines(asksHost); } catch {}
    }
  }
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    setTimeout(() => { paintQueued = false; if (sectionVisible()) paint(); }, 0);
  }
  function wire() {
    if (asksHost.dataset.wired) return;
    asksHost.dataset.wired = "1";
    asksHost.addEventListener("submit", (event) => event.preventDefault());
    bindWorkflowAskControls(asksHost);
    for (const type of ["click", "change", "input"]) asksHost.addEventListener(type, schedulePaint);
  }
  function paint() {
    try {
      const snap = sessionStripSnapshot();
      if (!snap) return;
      if (!snap.ready) {
        list.dataset.signature = "";
        asksHost.dataset.signature = "";
        list.replaceChildren();
        asksHost.replaceChildren();
        setStatus("세션 데이터가 로드되지 않았습니다.");
        return;
      }
      paintSessions(snap.sessions);
      paintAsks(snap.groups);
      setStatus(!snap.sessions.length && !snap.groups.length ? "진행 중인 세션이 없습니다." : "");
    } catch {
      try { setStatus("세션 데이터가 로드되지 않았습니다."); } catch {}
    }
  }
  function syncTimer() {
    if (!sectionVisible()) {
      if (timer) { clearInterval(timer); timer = 0; }
      return;
    }
    paint();
    if (!timer) timer = setInterval(() => { if (sectionVisible()) paint(); else syncTimer(); }, 2000);
  }

  wire();
  document.addEventListener("visibilitychange", syncTimer);
  document.addEventListener("omp-mode", syncTimer);
  const design = root.closest("#design");
  if (design && typeof MutationObserver === "function") {
    new MutationObserver(syncTimer).observe(design, { attributes: true, attributeFilter: ["hidden"] });
  }
  syncTimer();
})();
