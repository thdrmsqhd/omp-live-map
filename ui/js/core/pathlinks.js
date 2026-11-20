/* omp-live-map · core · assistant 본문 속 URL·경로 감지 (순수 함수, esc 를 거친 문자열에만 쓴다)
   종류(k): url · file(절대경로) · rel(상대경로). 링크는 span[data-plink] 로 만든다(a 태그는 맵 끌기에서 제외되기 때문). */

const PL_BODY = /(?<=^|\s|[(\[{<>,]|&quot;|&#39;|&lt;|&gt;)(?:https?:\/\/(?:[^\s\u0000<>"'`&]|&amp;)+|[^\s\u0000<>&"'`]+)/g;
const PL_LINE = /:\d+(?:-\d+)?(?::\d+)?$/;
const PL_SEG = /^[\w.@%+~=-]+$/;

// 후보 문자열을 { k, text } 로 분류한다. 링크가 아니면 null. text 는 줄 접미를 포함한 보이는 문자열.
function plClassify(raw) {
  if (/^https?:\/\/[^\s/]+/i.test(raw)) return { k: "url", text: raw };
  const bare = raw.replace(PL_LINE, "");
  if (/^[A-Za-z]:[\\/]/.test(bare)) return bare.length > 3 ? { k: "file", text: raw } : null;
  const parts = bare.split(/[\\/]/);
  const last = parts[parts.length - 1];
  const hasExt = /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(last);
  const segsOk = parts.slice(bare.startsWith("/") || bare.startsWith("~") ? 1 : 0).every((p) => p === "" || PL_SEG.test(p));
  if (!segsOk || /\/\/|\\\\/.test(bare)) return null;
  if (bare.startsWith("~/")) return bare.length > 2 ? { k: "file", text: raw } : null;
  if (bare.startsWith("/")) return bare.length > 1 && (parts.length > 2 || hasExt) ? { k: "file", text: raw } : null;
  if (parts.length > 1 && hasExt && parts.every(PL_SEG.test.bind(PL_SEG)) && !/^\d+$/.test(parts[0])) return { k: "rel", text: raw };
  return null;
}

// 후보 하나 → { k, text, rest } (rest = 문장 끝에서 잘려 나간 글자). 링크가 아니면 null.
function plSplit(cand) {
  let n = cand.length;
  while (n > 0 && ".,;:!?)]}".includes(cand[n - 1])) n--;
  const text = cand.slice(0, n);
  const r = n ? plClassify(text) : null;
  return r ? { ...r, rest: cand.slice(n) } : null;
}

const PL_TITLE = { url: "클릭: 새 탭에서 열기", file: "클릭: 경로 복사 · Ctrl+클릭: 편집기에서 열기", rel: "클릭: 경로 복사" };
function plSpan(r) {
  const open = r.k === "url" || (r.k === "file" && /\.html?$/i.test(r.text));
  const title = open ? "클릭: 브라우저에서 열기" : PL_TITLE[r.k];
  return `<span class="plink" data-plink="${r.text}" data-pk="${r.k}" title="${title}">${r.text}</span>`;
}

// esc 된 문자열 안의 URL·경로를 span 으로 바꾼다. 이미 만들어진 토큰(\u0000N\u0000)은 건드리지 않는다.
function plLinkify(escaped, wrap = (h) => h) {
  return escaped.replace(PL_BODY, (cand) => {
    const r = plSplit(cand);
    return r ? wrap(plSpan(r)) + r.rest : cand;
  });
}

if (typeof module !== "undefined") module.exports = { plLinkify, plSplit };
