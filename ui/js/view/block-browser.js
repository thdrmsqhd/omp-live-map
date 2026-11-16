/* omp-live-map · view · browser 블록 (개발 서버·로컬 html 미리보기용 iframe) */

// 블록을 더하면 브라우저 블록이 이 크기(px, 지도 좌표)가 되도록 열린 큰 카드를 키운다.
const BROWSER_FIT = { blockW: 1920, blockH: 1080 };

function browserBlock(n) {
  const st = BURL.get(n.id) || { url: "" };
  return `<div class="brow">
    <div class="tinfo"><span>browser</span><span class="cwd">${esc(st.url || "URL·로컬 html 경로 입력 후 Enter")}</span>
      <button data-breload="1" title="새로고침" style="padding:0 6px;font-size:10px">⟳</button>
      <button data-bgo="1" style="padding:0 6px;font-size:10px">열기</button></div>
    <input class="bin" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:8080 · C:\\폴더\\index.html · file:///…" value="${esc(st.url)}">
    <div class="berr" hidden></div>
    <iframe class="bframe" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
  </div>`;
}

const isLoopback = (h) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

// 로컬 파일 입력(C:\a\b.html, file:///C:/a/b.html, /home/a/b.html)이면 절대 경로를, 아니면 "" 를 돌려준다.
function localPathOf(raw) {
  const s = String(raw || "").trim().replace(/^"(.*)"$/, "$1");   // 탐색기 "경로로 복사"는 따옴표로 감싼다.
  if (/^file:/i.test(s)) {
    try {
      const p = decodeURIComponent(new URL(s).pathname);
      return /^\/[A-Za-z]:/.test(p) ? p.slice(1).replace(/\//g, "\\") : p;
    } catch { return ""; }
  }
  if (/^[A-Za-z]:[\\/]/.test(s)) return s.replace(/\//g, "\\");
  return s.startsWith("/") ? s : "";
}

// 열 수 있는 주소면 { url, local } 을, 아니면 사유를 돌려준다. local 이면 url 은 파일 경로다.
function checkBrowserUrl(raw) {
  const file = localPathOf(raw);
  if (file) return { url: file, local: true };
  let parsed;
  try { parsed = new URL(String(raw || "").trim()); } catch { return { error: "URL 이나 로컬 파일 경로가 아닙니다" }; }
  if (!/^https?:$/.test(parsed.protocol)) return { error: "http/https 또는 로컬 파일만 열 수 있습니다" };
  const sameHost = parsed.hostname === location.hostname || (isLoopback(parsed.hostname) && isLoopback(location.hostname));
  if (sameHost && parsed.port === location.port) return { error: "이 화면 자신은 넣을 수 없습니다(무한 중첩)" };
  return { url: parsed.href, local: false };
}

// 로컬 파일을 서버 경유 주소로 바꾼다. iframe 은 http 페이지에서 file:// 을 열 수 없다.
// 토큰은 서버를 다시 켜면 바뀌므로 띄울 때마다 받는다.
async function localFrameUrl(file) {
  const res = await fetch("/api/localfs");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const { base } = await res.json();
  return base + file.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join("/");
}

function mountBrowser(box, n) {
  const input = box.querySelector(".bin");
  const frame = box.querySelector(".bframe");
  const urlBox = box.querySelector(".cwd");
  const err = box.querySelector(".berr");
  let st = BURL.get(n.id);
  if (!st) { st = { url: "", local: false }; BURL.set(n.id, st); }
  const setErr = (msg) => { err.hidden = !msg; err.textContent = msg || ""; };
  let seq = 0;
  // 페이지를 띄우기 전에는 어두운 빈 칸으로 두고, 띄운 뒤에만 흰 바탕을 준다(배경 없는 페이지 대비).
  const show = async () => {
    const my = ++seq;
    urlBox.textContent = st.url;
    let src = st.url;
    if (st.local) {
      try { src = await localFrameUrl(st.url); } catch (e) { return setErr("로컬 파일 주소를 받지 못했습니다: " + e.message); }
      if (my !== seq) return;
    }
    frame.src = src;
    frame.classList.add("on");
  };
  if (st.url) show();
  const open = () => {
    if (!input.value.trim()) return;
    const res = checkBrowserUrl(input.value);
    setErr(res.error);
    if (res.error) return;
    st.url = res.url;
    st.local = res.local;
    show();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  box.querySelector("[data-bgo]").addEventListener("click", open);
  // 새로고침: 같은 주소를 다시 띄운다(로컬 파일은 토큰도 다시 받는다).
  box.querySelector("[data-breload]").addEventListener("click", () => { if (st.url) { setErr(""); show(); } });
}

// 블록을 더한 직후: 작은 카드는 열고, 큰 카드는 BROWSER_FIT 까지 키운다(이미 충분하면 그대로).
// 블록을 고정 높이로 바꾸며 늘어난 만큼 카드도 늘려 다른 블록 자리는 그대로 둔다.
// 키운 양은 u.fit.browser 에 남겨 블록을 뺄 때 unfitBrowserCard 가 되돌린다.
function fitBrowserCard(id) {
  if (!openIds.has(id)) openNode(id);
  const u = cardUI(id);
  if (u.collapsed.browser) { delete u.collapsed.browser; saveCardUI(); renderMap(false, true); }
  const box = BIGPOS.get(id);
  const blk = $("nodes").querySelector(`.node.big[data-id="${CSS.escape(id)}"] .blk[data-blk="browser"]`);
  if (!box || !blk) return;
  const r = blk.getBoundingClientRect();
  const k = view.k || 1;
  const cur = r.height / k;
  const grow = Math.max(0, Math.ceil(BROWSER_FIT.blockH - cur));
  const w = Math.max(box.w || BIG_W, Math.ceil((box.w || BIG_W) + BROWSER_FIT.blockW - r.width / k));
  const h = (box.h || BIG_H) + grow;
  if (grow) { u.h.browser = BROWSER_FIT.blockH; }
  u.fit.browser = { w: w - (box.w || BIG_W), h: grow };
  saveCardUI();
  if (w !== box.w || h !== box.h) {
    pushHistory(layoutSnapshot({ big: [id] }));
    BIGPOS.set(id, { ...box, w, h });
    saveOpenCards();
  }
  if (grow || w !== box.w) renderMap(false, true);
}

// 블록을 뺄 때: fitBrowserCard 가 키운 만큼만 줄이고 고정 높이를 지운다. 기록이 없으면 크기는 그대로 둔다.
function unfitBrowserCard(id) {
  const u = cardUI(id);
  const f = u.fit.browser;
  delete u.h.browser;
  delete u.fit.browser;
  saveCardUI();
  const box = BIGPOS.get(id);
  if (!box || !f || (!f.w && !f.h)) return;
  pushHistory(layoutSnapshot({ big: [id] }));
  BIGPOS.set(id, { ...box, w: Math.max(BIG_W, (box.w || BIG_W) - f.w), h: Math.max(BIG_H, (box.h || BIG_H) - f.h) });
  saveOpenCards();
}

registerBlock({ type: "browser", slot: "main", flex: 0.8, render: browserBlock, mount: mountBrowser, onAdd: fitBrowserCard, onRemove: unfitBrowserCard });
