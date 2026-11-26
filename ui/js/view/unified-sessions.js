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

  const localCards = new WeakMap();
  let timer = 0;
  let paintQueued = false;

  function text(value) {
    return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }
  function designMode() {
    try { return typeof mapMode !== "undefined" && mapMode === "design"; } catch { return false; }
  }
  function hasSessionData() {
    try {
      if (typeof DATA !== "undefined" && DATA && Array.isArray(DATA.sessions)) return true;
    } catch {}
    try {
      if (typeof ASKS !== "undefined" && ASKS && typeof ASKS[Symbol.iterator] === "function") return true;
    } catch {}
    return typeof filteredSessions === "function" || typeof nodeById === "function";
  }
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
  function sessionTitle(session) {
    const nodes = Array.isArray(session && session.nodes) ? session.nodes : [];
    const main = nodes.find((node) => node && node.kind === "main");
    try {
      if (main && typeof ALIAS !== "undefined" && ALIAS && typeof ALIAS.get === "function") {
        const alias = ALIAS.get(main.id);
        if (alias) return String(alias);
      }
    } catch {}
    return String((session && (session.title || session.name || session.key)) || (main && main.name) || "세션");
  }
  function isActiveSession(session) {
    if (!session || typeof session !== "object") return false;
    if (session.live) return true;
    const nodes = Array.isArray(session.nodes) ? session.nodes : [];
    if (nodes.some((node) => node && node.status === "live")) return true;
    const last = Number(session.lastTs);
    return Number.isFinite(last) && last > 0 && Date.now() - last < 30 * 60 * 1000;
  }
  function activeSessions() {
    let source = [];
    try {
      if (typeof filteredSessions === "function") {
        const filtered = filteredSessions();
        if (Array.isArray(filtered)) source = filtered;
      }
    } catch {}
    if (!source.length) {
      try {
        if (typeof DATA !== "undefined" && Array.isArray(DATA.sessions)) source = DATA.sessions;
      } catch {}
    }
    return source.filter(isActiveSession);
  }
  function askNodeId(key) {
    try {
      if (typeof inboxSessionId === "function") {
        const id = inboxSessionId(key);
        if (id) return String(id);
      }
    } catch {}
    try {
      if (typeof liveNodeId === "function") {
        const id = liveNodeId(key);
        if (id) return String(id);
      }
    } catch {}
    return String(key);
  }
  function knownSessions() {
    const lists = [];
    try {
      if (typeof DATA !== "undefined" && Array.isArray(DATA.sessions)) lists.push(...DATA.sessions);
    } catch {}
    try {
      if (typeof filteredSessions === "function") {
        const filtered = filteredSessions();
        if (Array.isArray(filtered)) lists.push(...filtered);
      }
    } catch {}
    return lists;
  }
  function sessionFor(id) {
    const wanted = String(id || "").replace(/\\/g, "/").toLowerCase();
    if (!wanted) return null;
    return knownSessions().find((session) => {
      const nodes = Array.isArray(session && session.nodes) ? session.nodes : [];
      return nodes.some((node) => node && String(node.id || "").replace(/\\/g, "/").toLowerCase() === wanted)
        || String(session && session.key || "").replace(/\\/g, "/").toLowerCase() === wanted;
    }) || null;
  }
  function askTitle(key, id) {
    try {
      if (typeof nodeById === "function") {
        const node = nodeById(id);
        if (node && typeof attnTitle === "function") {
          const title = attnTitle(node);
          if (title) return String(title);
        }
        if (node && (node.sessionTitle || node.title || node.name)) return String(node.sessionTitle || node.title || node.name);
      }
    } catch {}
    const session = sessionFor(id) || sessionFor(key);
    if (session) return sessionTitle(session);
    try {
      if (typeof ATTN !== "undefined" && ATTN && typeof ATTN.get === "function") {
        const item = ATTN.get(id) || ATTN.get(key);
        if (item && item.title) return String(item.title);
      }
    } catch {}
    try {
      if (typeof isWorkflowAskSession === "function" && isWorkflowAskSession(key)) return "Workflow 에이전트";
    } catch {}
    return String(key || id || "세션").split("/").pop() || "세션";
  }
  function pendingAsks() {
    if (typeof ASKS === "undefined" || !ASKS || typeof ASKS[Symbol.iterator] !== "function") return [];
    const groups = [];
    try {
      for (const entry of ASKS) {
        if (!entry || entry.length < 2 || !Array.isArray(entry[1]) || !entry[1].length) continue;
        const key = String(entry[0]);
        const id = askNodeId(key);
        groups.push({ key, id, list: entry[1], title: askTitle(key, id) });
      }
    } catch {}
    return groups;
  }
  function askMarkup(items) {
    if (typeof askCardHTML === "function" && typeof esc === "function") {
      try { return items.map((request, index) => askCardHTML(request, index)).join(""); } catch {}
    }
    return items.map((request, index) => {
      const title = request && (request.method === "ask" ? `${(request.questions || []).length}개 질문` : request.title) || "질문";
      const confirm = request && request.method === "confirm";
      const send = !confirm && typeof askSend === "function" ? `<button type="button" data-ask-send="1">보내기</button>` : "";
      const yes = confirm && typeof askConfirm === "function" ? `<button type="button" data-ask-confirm="1">승인</button><button type="button" data-ask-confirm="0">거부</button>` : "";
      const cancel = typeof askCancel === "function" ? `<button type="button" data-ask-cancel="1">취소</button>` : "";
      return `<div class="cask" data-ask-card="${index}"><div class="cask-h"><span class="cask-t">${text(title)}</span></div><div class="cask-f">${send}${yes}${cancel}</div></div>`;
    }).join("");
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
    if (typeof trackWorkflowAskCards === "function") {
      try { trackWorkflowAskCards(section, id, listForCards); } catch {}
    }
    for (const card of section.querySelectorAll("[data-ask-card]")) {
      const request = listForCards[+card.dataset.askCard];
      if (request) localCards.set(card, { id, request });
      for (const button of card.querySelectorAll("button")) button.type = "button";
    }
    if (typeof syncAskFields === "function") {
      try { syncAskFields(section, listForCards); } catch {}
    }
  }
  function paintSessions(sessions) {
    const signature = sessions.map((session) => `${session && session.key}\0${sessionTitle(session)}`).join("\n");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren();
    for (const session of sessions) {
      const item = document.createElement("li");
      item.className = "unified-session";
      if (session && session.key != null) item.dataset.sessionKey = String(session.key);
      const title = document.createElement("span");
      title.className = "unified-session-title";
      title.textContent = sessionTitle(session);
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
  function hitOf(target) {
    const card = target && target.closest && target.closest("[data-ask-card]");
    return card ? localCards.get(card) : null;
  }
  function callAsk(fn, args) {
    if (typeof fn !== "function") return;
    try { fn(...args); } catch {}
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
    if (typeof bindWorkflowAskControls === "function" && typeof trackWorkflowAskCards === "function") {
      try { bindWorkflowAskControls(asksHost); } catch {}
      for (const type of ["click", "change", "input"]) asksHost.addEventListener(type, schedulePaint);
      return;
    }
    asksHost.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest("button");
      const hit = button && hitOf(button);
      if (!hit) return;
      if (button.dataset.askSend != null) callAsk(typeof askSend === "function" ? askSend : null, [hit.id, hit.request.id]);
      else if (button.dataset.askConfirm != null) callAsk(typeof askConfirm === "function" ? askConfirm : null, [hit.id, hit.request.id, button.dataset.askConfirm === "1"]);
      else if (button.dataset.askCancel != null) callAsk(typeof askCancel === "function" ? askCancel : null, [hit.id, hit.request.id]);
      schedulePaint();
    });
    asksHost.addEventListener("change", (event) => {
      const hit = hitOf(event.target);
      if (!hit) return;
      const field = event.target.dataset || {};
      if (field.askOpt != null) callAsk(typeof askPick === "function" ? askPick : null, [hit.id, hit.request.id, +field.askOpt, field.askLabel]);
      else if (field.askSel != null) callAsk(typeof askSelect === "function" ? askSelect : null, [hit.id, hit.request.id, +field.askSel]);
      schedulePaint();
    });
    asksHost.addEventListener("input", (event) => {
      const hit = hitOf(event.target);
      if (!hit) return;
      const field = event.target.dataset || {};
      if (field.askCustom != null) callAsk(typeof askCustom === "function" ? askCustom : null, [hit.id, hit.request.id, +field.askCustom, event.target.value]);
      else if (field.askValue != null) callAsk(typeof askValue === "function" ? askValue : null, [hit.id, hit.request.id, event.target.value]);
    });
    asksHost.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
      const hit = hitOf(event.target);
      if (!hit) return;
      event.preventDefault();
      if (hit.request.method === "confirm") callAsk(typeof askConfirm === "function" ? askConfirm : null, [hit.id, hit.request.id, true]);
      else callAsk(typeof askSend === "function" ? askSend : null, [hit.id, hit.request.id]);
      schedulePaint();
    });
  }
  function paint() {
    try {
      if (!designMode()) return;
      if (!hasSessionData()) {
        list.dataset.signature = "";
        asksHost.dataset.signature = "";
        list.replaceChildren();
        asksHost.replaceChildren();
        setStatus("세션 데이터가 로드되지 않았습니다.");
        return;
      }
      const sessions = activeSessions();
      const groups = pendingAsks();
      paintSessions(sessions);
      paintAsks(groups);
      setStatus(!sessions.length && !groups.length ? "진행 중인 세션이 없습니다." : "");
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
