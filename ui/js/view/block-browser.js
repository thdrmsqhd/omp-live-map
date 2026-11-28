/* omp-live-map · view · browser 블록 (개발 서버·로컬 html 미리보기용 iframe) */

// 블록을 더하면 브라우저 블록이 이 크기(px, 지도 좌표)가 되도록 열린 큰 카드를 키운다.
const BROWSER_FIT = { blockW: 1920, blockH: 1080 };
document.documentElement.style.setProperty("--browser-col", BROWSER_FIT.blockW + "px");   // .col-left 폭(panel.css)

function browserBlock(n, key = "browser") {
  const st = BURL.get(burlKey(n.id, key)) || { url: "" };
  const num = key === "browser" ? "" : " " + key.split("#").pop();
  return `<div class="brow">
    <div class="tinfo"><span>browser${num}</span><span class="cwd">${esc(st.url || "URL·로컬 html 경로 입력 후 Enter")}</span>
      <button data-breload="1" title="새로고침" style="padding:0 6px;font-size:10px">⟳</button>
      <button data-bgo="1" style="padding:0 6px;font-size:10px">열기</button></div>
    <input class="bin" aria-label="열 주소 또는 파일 경로" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:8080 · C:\\폴더\\index.html · file:///…" value="${esc(st.url)}">
    <div class="berr" hidden></div>
    <iframe class="bframe" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
  </div>`;
}

// 브라우저 블록 상태 키. 첫 인스턴스는 nodeId, 두 번째부터는 nodeId#browser#2 (persist.js 가 같은 키로 저장한다).
const burlKey = (id, key) => (key && key !== "browser" ? id + "#" + key : id);

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
  const key = box.dataset.bkey || "browser";
  const sk = burlKey(n.id, key);
  const input = box.querySelector(".bin");
  const frame = box.querySelector(".bframe");
  const urlBox = box.querySelector(".cwd");
  const err = box.querySelector(".berr");
  let st = BURL.get(sk);
  if (!st) { st = { url: "", local: false }; BURL.set(sk, st); }
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
    saveBrowserUrls();
    show();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  box.querySelector("[data-bgo]").addEventListener("click", open);
  // 새로고침: 같은 주소를 다시 띄운다(로컬 파일은 토큰도 다시 받는다).
  box.querySelector("[data-breload]").addEventListener("click", () => { if (st.url) { setErr(""); show(); } });
}

// 블록을 더한 직후: 작은 카드는 열고, 큰 카드는 BROWSER_FIT 까지 키운다(이미 충분하면 그대로).
// 블록을 고정 높이로 바꾸며 늘어난 만큼 카드도 늘려 다른 블록 자리는 그대로 둔다.
// 키운 양은 u.fit[key] 에 남겨 블록을 뺄 때 unfitBrowserCard 가 되돌린다.
// 두 번째 인스턴스는 카드를 더 키우지 않고 첫 블록과 남은 공간을 나눠 쓴다.
function fitBrowserCard(id, key = "browser") {
  if (!openIds.has(id) || ELS.get(id)?.dataset.virtual) openNode(id);
  const u = cardUI(id);
  if (u.collapsed[key]) { delete u.collapsed[key]; saveCardUI(); renderMap(false, true); }
  if (key !== "browser") return;
  const box = BIGPOS.get(id);
  const blk = $("nodes").querySelector(`.node.big[data-id="${CSS.escape(id)}"] .blk[data-bkey="${CSS.escape(key)}"]`);
  if (!box || !blk || mapMode !== "map") return;
  const r = blk.getBoundingClientRect();
  const k = view.k || 1;
  // 대화가 있는 카드는 브라우저가 왼쪽 열(.col-left, 고정 폭 blockW)로 새로 붙는다: 열 폭 + 간격(10)만큼 카드를 넓혀 대화·편집기 폭을 그대로 둔다.
  const col = blk.dataset.slot === "left";
  const cur = r.height / k;
  const grow = col ? 0 : Math.max(0, Math.ceil(BROWSER_FIT.blockH - cur));
  const w = col ? (box.w || BIG_W) + BROWSER_FIT.blockW + 10
    : Math.max(box.w || BIG_W, Math.ceil((box.w || BIG_W) + BROWSER_FIT.blockW - r.width / k));
  const h = (box.h || BIG_H) + grow;
  if (grow) { u.h[key] = BROWSER_FIT.blockH; }
  u.fit[key] = { w: w - (box.w || BIG_W), h: grow };
  saveCardUI();
  if (w !== box.w || h !== box.h) {
    pushHistory(layoutSnapshot({ big: [id] }));
    BIGPOS.set(id, { ...box, w, h });
    saveOpenCards();
  }
  if (grow || w !== box.w) renderMap(false, true);
}

// 블록을 뺄 때: fitBrowserCard 가 키운 만큼만 줄이고 고정 높이를 지운다. 기록이 없으면 크기는 그대로 둔다.
// 다른 브라우저 블록이 남아 있으면 키운 자리·고정 높이를 그 블록에 물려주고 카드는 그대로 둔다(마지막 하나를 뺄 때 되돌린다).
function unfitBrowserCard(id, key = "browser") {
  const u = cardUI(id);
  const f = u.fit[key];
  const h = u.h[key];
  delete u.h[key];
  delete u.fit[key];
  const node = nodeById(id);
  const rest = node ? blockInstances(cardBlockTypes(node), "browser").filter((k) => k !== key) : [];
  if (rest.length) {
    const heir = rest[0];
    if (f && !u.fit[heir]) u.fit[heir] = f;
    if (Number.isFinite(h) && !u.h[heir]) u.h[heir] = h;
    saveCardUI();
    return;
  }
  saveCardUI();
  const box = BIGPOS.get(id);
  if (!box || !f || (!f.w && !f.h)) return;
  pushHistory(layoutSnapshot({ big: [id] }));
  BIGPOS.set(id, { ...box, w: Math.max(BIG_MIN_W, (box.w || BIG_W) - f.w), h: Math.max(BIG_MIN_H, (box.h || BIG_H) - f.h) });
  saveOpenCards();
}

registerBlock({ type: "browser", slot: "main", flex: 0.8, render: browserBlock, mount: mountBrowser, onAdd: fitBrowserCard, onRemove: unfitBrowserCard });
