/* omp-live-map · view · 답변 속 링크(span[data-plink]) 클릭: URL·로컬 html 은 열고, 경로는 복사한다 */

function plToast(msg, bad) {
  let el = document.getElementById("plToast");
  if (!el) { el = document.createElement("div"); el.id = "plToast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = "on" + (bad ? " bad" : "");
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.className = ""; }, 1600);
}

function plCopy(text) {
  if (!navigator.clipboard) return plToast("복사 실패", true);
  navigator.clipboard.writeText(text).then(() => plToast("복사됨: " + text), () => plToast("복사 실패", true));
}

// 끌기 직후(suppressClickUntil)나 글자를 고르는 중에는 아무것도 하지 않는다.
async function plinkClick(e, el, nodeId) {
  if (Date.now() < suppressClickUntil || String(getSelection()) !== "") return;
  const text = el.dataset.plink, kind = el.dataset.pk;
  const file = kind === "file" ? localPathOf(text) : "";   // 절대 경로(~ 는 "")
  if (file && e.ctrlKey) return openEditor(nodeId, file.replace(/:\d+(?:-\d+)?(?::\d+)?$/, ""));
  if (kind === "url") return void window.open(text, "_blank", "noopener,noreferrer");
  if (file && /\.html?$/i.test(file)) {
    try { window.open(await localFrameUrl(file), "_blank", "noopener,noreferrer"); } catch (err) { plToast("열기 실패: " + err.message, true); }
    return;
  }
  plCopy(text);
}
