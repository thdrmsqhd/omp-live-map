/* omp-live-map · view · 대화 말풍선 이미지(blob 미리보기 · 지연 URL · base64) */

// 사용자 말풍선 이미지: blob 미리보기가 있으면 그것을, 없으면 기록의 {mime, url("/api/img/…")} 또는
// {mime, data(base64)} 를 그린다. 허용 MIME·URL·base64 모양·크기를 확인하고 이상한 항목은 건너뛴다.
const CHAT_IMG_MAX_B64 = 24 * 1024 * 1024;
const CHAT_IMG_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// 서버의 지연 이미지 주소(같은 출처 "/api/img/<id>" 만). 그 밖의 URL 은 무시해 외부 리소스를 싣지 않는다.
function chatImageURL(u) {
  const s = String(u || "");
  if (!s.startsWith("/api/img/") || s.length > 2000) return "";
  return /[\s"'<>\\\x00-\x1f]/.test(s) ? "" : s;
}

function chatImagesHTML(m, previews) {
  if (m.__imgsHTML !== undefined && m.__imgsKey === m.images && m.__prevKey === previews) return m.__imgsHTML;
  const out = [];
  for (const url of Array.isArray(previews) ? previews : []) {
    if (typeof url === "string" && url.startsWith("blob:")) out.push(`<img src="${esc(url)}" alt="첨부 이미지">`);
  }
  if (!out.length) {
    for (const it of Array.isArray(m.images) ? m.images : []) {
      const mime = String((it && it.mime) || "").toLowerCase();
      if (!IMAGE_MIMES.has(mime)) continue;
      const data = String((it && it.data) || "").replace(/\s/g, "");
      if (data) {
        if (data.length > CHAT_IMG_MAX_B64 || data.length % 4 === 1 || !CHAT_IMG_B64.test(data)) continue;
        out.push(`<img src="data:${mime};base64,${data}" alt="첨부 이미지" loading="lazy" decoding="async">`);
        continue;
      }
      const url = chatImageURL(it && it.url);
      if (url) out.push(`<img src="${esc(url)}" alt="첨부 이미지" loading="lazy" decoding="async">`);
    }
  }
  const html = out.length ? `<div class="cimgs">${out.join("")}</div>` : "";
  m.__imgsKey = m.images;
  m.__prevKey = previews;
  m.__imgsHTML = html;
  return html;
}
