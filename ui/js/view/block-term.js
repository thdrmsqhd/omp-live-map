/* omp-live-map · view · terminal 블록 (Git Bash 명령 실행·기록·출력 검색) */

const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 터미널 출력 HTML. 검색어가 있으면 일치 부분을 <mark> 로 감싸고 개수를 센다.
function termBody(st) {
  const q = st.q || "";
  if (!q) return { html: st.lines.map((l) => `<div class="${l.c || ""}">${esc(l.t)}</div>`).join(""), hits: 0 };
  const re = new RegExp(reEscape(q), "gi");
  let hits = 0;
  const html = st.lines.map((l) => {
    const t = String(l.t ?? "");
    let out = "";
    let last = 0;
    let m;
    const before = hits;
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      out += esc(t.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
      hits++;
    }
    out += esc(t.slice(last));
    return `<div class="${(l.c || "") + (hits > before ? " hit" : "")}">${out}</div>`;
  }).join("");
  return { html, hits };
}

const termCount = (st, hits) => (st.q ? `${hits ? Math.min((st.qi || 0) + 1, hits) : 0}/${hits}` : "");

// 출력을 다시 그린다. 맨 아래를 보고 있었거나 stick 이면 하단을 따라가고, 위로 올려 둔 위치는 지킨다.
function paintTerm(id, stick) {
  const el = ELS.get(id);
  const st = TERM.get(id);
  const pre = el && el.querySelector(".tout");
  if (!pre || !st) return;
  const top = pre.scrollTop;
  const atBottom = top + pre.clientHeight >= pre.scrollHeight - 8;
  const { html, hits } = termBody(st);
  pre.innerHTML = html;
  if (st.q) {
    // 검색 중에는 하단으로 끌고 가지 않는다. 검색어 변경·Enter 때만 현재 일치로 이동.
    if (!((st.qi || 0) < hits)) st.qi = 0;
    const cur = pre.querySelectorAll("mark")[st.qi || 0];
    if (cur) cur.classList.add("cur");
    pre.scrollTop = cur && st.qJump ? Math.max(0, cur.offsetTop - pre.clientHeight / 2) : top;
    st.qJump = false;
  } else {
    pre.scrollTop = stick || atBottom ? pre.scrollHeight : top;
  }
  const cnt = el.querySelector(".term .tqn");
  if (cnt) cnt.textContent = termCount(st, hits);
  const cwdEl = el.querySelector(".term .cwd");
  if (cwdEl && !cwdEl.dataset.flash) cwdEl.textContent = st.cwd || "-";
}

function termBlock(n) {
  const st = termState(n);
  const { html, hits } = termBody(st);
  return `<div class="term">
    <div class="tinfo"><span>terminal</span><span>·</span><span>Git Bash</span>
      <span class="cwd" title="클릭: 경로 복사">${esc(st.cwd || "-")}</span>
      <input class="tq" autocomplete="off" spellcheck="false" placeholder="검색" value="${esc(st.q || "")}">
      <span class="tqn">${termCount(st, hits)}</span>
      <button data-clear="1" style="padding:0 6px;font-size:10px">clear</button></div>
    <pre class="tout">${html}</pre>
    <div class="tline"><span>$</span><input class="tin" autocomplete="off" spellcheck="false" placeholder="명령 입력 후 Enter (Shift+Enter: 백그라운드, ↑↓: 기록)"></div>
  </div>`;
}

// ↑/↓: 세션별 명령 기록 이동. 기록 끝(현재 위치)으로 돌아오면 입력하던 draft 를 되살린다.
function termHistoryKey(e, st, tin) {
  const h = st.hist || [];
  if (!h.length) return;
  e.preventDefault();
  if (!(st.hi >= 0 && st.hi <= h.length)) st.hi = h.length;
  if (e.key === "ArrowUp") {
    if (st.hi === h.length) st.hdraft = tin.value;
    st.hi = Math.max(0, st.hi - 1);
  } else {
    if (st.hi >= h.length) return;
    st.hi++;
  }
  tin.value = st.hi === h.length ? (st.hdraft || "") : h[st.hi];
  st.draft = tin.value;
  tin.setSelectionRange(tin.value.length, tin.value.length);
}

function mountTerm(box, n) {
  const id = n.id;
  const st = termState(n);
  const pre = box.querySelector(".tout");
  const tin = box.querySelector(".tin");
  const tq = box.querySelector(".tq");
  tin.value = st.draft || "";
  tin.addEventListener("input", () => { st.draft = tin.value; });
  tin.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") return termHistoryKey(e, st, tin);
    if (e.key !== "Enter") return;
    const cmd = tin.value;
    tin.value = "";
    st.draft = "";
    if (!cmd.trim()) return;
    if (e.shiftKey) startBgJob(id, st.cwd, cmd);
    else runTerm(id, cmd);
  });
  tq.addEventListener("input", () => { st.q = tq.value; st.qi = 0; st.qJump = true; paintTerm(id); });
  tq.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const total = pre.querySelectorAll("mark").length;
      if (!total) return;
      st.qi = ((st.qi || 0) + (e.shiftKey ? total - 1 : 1)) % total;
      st.qJump = true;
      paintTerm(id);
    } else if (e.key === "Escape") {
      tq.value = "";
      st.q = "";
      paintTerm(id);
    }
  });
  const cwd = box.querySelector(".cwd");
  cwd.addEventListener("click", () => copyText(st.cwd || "", cwd));
  box.querySelector("[data-clear]").addEventListener("click", () => { st.lines = []; paintTerm(id); });
  if (st.q) { st.qJump = true; paintTerm(id); } else pre.scrollTop = pre.scrollHeight;
}

registerBlock({ type: "terminal", slot: "main", flex: 1.3, render: termBlock, mount: mountTerm });
