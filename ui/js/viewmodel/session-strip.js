/* 설계 화면의 세션 스트립에 올릴 세션과 질문 묶음. DOM 은 만들지 않는다. */

function sessionStripHasData() {
  try {
    if (typeof DATA !== "undefined" && DATA && Array.isArray(DATA.sessions)) return true;
  } catch {}
  try {
    if (typeof ASKS !== "undefined" && ASKS && typeof ASKS[Symbol.iterator] === "function") return true;
  } catch {}
  return typeof filteredSessions === "function" || typeof nodeById === "function";
}

function sessionStripTitle(session) {
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

function sessionStripActive(session) {
  if (!session || typeof session !== "object") return false;
  if (session.live) return true;
  const nodes = Array.isArray(session.nodes) ? session.nodes : [];
  if (nodes.some((node) => node && node.status === "live")) return true;
  const last = Number(session.lastTs);
  return Number.isFinite(last) && last > 0 && Date.now() - last < 30 * 60 * 1000;
}

function sessionStripSessions() {
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
  return source.filter(sessionStripActive);
}

function sessionStripKnown() {
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

function sessionStripFor(id) {
  const wanted = String(id || "").replace(/\\/g, "/").toLowerCase();
  if (!wanted) return null;
  return sessionStripKnown().find((session) => {
    const nodes = Array.isArray(session && session.nodes) ? session.nodes : [];
    return nodes.some((node) => node && String(node.id || "").replace(/\\/g, "/").toLowerCase() === wanted)
      || String(session && session.key || "").replace(/\\/g, "/").toLowerCase() === wanted;
  }) || null;
}

function sessionStripAskTitle(key, id) {
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
  const session = sessionStripFor(id) || sessionStripFor(key);
  if (session) return sessionStripTitle(session);
  try {
    if (typeof ATTN !== "undefined" && ATTN && typeof ATTN.get === "function") {
      const item = ATTN.get(id) || ATTN.get(key);
      if (item && item.title) return String(item.title);
    }
  } catch {}
  if (typeof isWorkflowAskSession === "function" && isWorkflowAskSession(key)) return "Workflow 에이전트";
  return String(key || id || "세션").split("/").pop() || "세션";
}

function sessionStripAskGroups() {
  if (typeof ASKS === "undefined" || !ASKS || typeof ASKS[Symbol.iterator] !== "function") return [];
  const groups = [];
  try {
    for (const entry of ASKS) {
      if (!entry || entry.length < 2 || !Array.isArray(entry[1]) || !entry[1].length) continue;
      const key = String(entry[0]);
      const id = String(typeof inboxSessionId === "function" ? inboxSessionId(key) : key);
      groups.push({ key, id, list: entry[1], title: sessionStripAskTitle(key, id) });
    }
  } catch {}
  return groups;
}

function sessionStripSnapshot() {
  if (mapMode !== "design") return null;
  if (!sessionStripHasData()) return { ready: false, sessions: [], groups: [] };
  return { ready: true, sessions: sessionStripSessions(), groups: sessionStripAskGroups() };
}
