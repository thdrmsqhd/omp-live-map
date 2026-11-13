/* omp-live-map · view · browser 블록 (개발 서버 미리보기용 iframe) */

function browserBlock(n) {
  const st = BURL.get(n.id) || { url: "" };
  return `<div class="brow">
    <div class="tinfo"><span>browser</span><span class="cwd">${esc(st.url || "URL 입력 후 Enter")}</span>
      <button data-bgo="1" style="padding:0 6px;font-size:10px">열기</button></div>
    <input class="bin" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:8080" value="${esc(st.url)}">
    <div class="berr" hidden></div>
    <iframe class="bframe" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
  </div>`;
}

const isLoopback = (h) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

// 열 수 있는 주소면 정규화한 URL 을, 아니면 사유를 돌려준다.
function checkBrowserUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw || "").trim()); } catch { return { error: "URL 형식이 아닙니다" }; }
  if (!/^https?:$/.test(parsed.protocol)) return { error: "http/https 만 열 수 있습니다" };
  const sameHost = parsed.hostname === location.hostname || (isLoopback(parsed.hostname) && isLoopback(location.hostname));
  if (sameHost && parsed.port === location.port) return { error: "이 화면 자신은 넣을 수 없습니다(무한 중첩)" };
  return { url: parsed.href };
}

function mountBrowser(box, n) {
  const input = box.querySelector(".bin");
  const frame = box.querySelector(".bframe");
  const urlBox = box.querySelector(".cwd");
  const err = box.querySelector(".berr");
  let st = BURL.get(n.id);
  if (!st) { st = { url: "" }; BURL.set(n.id, st); }
  // 페이지를 띄우기 전에는 어두운 빈 칸으로 두고, 띄운 뒤에만 흰 바탕을 준다(배경 없는 페이지 대비).
  const show = (url) => { frame.src = url; frame.classList.add("on"); urlBox.textContent = url; };
  if (st.url) show(st.url);
  const open = () => {
    if (!input.value.trim()) return;
    const res = checkBrowserUrl(input.value);
    err.hidden = !res.error;
    err.textContent = res.error || "";
    if (res.error) return;
    st.url = res.url;
    show(res.url);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  box.querySelector("[data-bgo]").addEventListener("click", open);
}

registerBlock({ type: "browser", slot: "main", flex: 0.8, render: browserBlock, mount: mountBrowser });
