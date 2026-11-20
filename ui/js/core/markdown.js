/* omp-live-map · core · 작은 Markdown 렌더러 (의존성 없음)
   원문은 항상 esc 를 거친 뒤 태그를 붙인다. 링크는 http(s)만 허용한다.
   지원: 제목(#~###), 굵게·기울임·취소선, 인라인 코드, fenced 코드(닫히지 않아도 됨),
   글머리표·번호 목록(중첩 1단계), 인용, GFM 표, 링크, 구분선, 문단(원문 개행 유지). */

const MD_FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const MD_HEAD = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const MD_HR = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const MD_QUOTE = /^\s{0,3}>[ \t]?/;
const MD_LIST = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const MD_TSEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

// assistant 답변만 true: URL·경로를 span[data-plink] 로 만든다(core/pathlinks.js). mdHTML 이 호출 동안만 켠다.
let MD_LINKS = false;

// 인라인: 코드·링크를 먼저 토큰으로 빼 두고 나머지를 escape 한 뒤 강조를 붙인다.
function mdInline(src) {
  const toks = [];
  const tok = (html) => "\u0000" + (toks.push(html) - 1) + "\u0000";
  let s = String(src).replace(/\u0000/g, "");
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, t, c) => tok(`<code>${MD_LINKS ? plLinkify(esc(c)) : esc(c)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+&quot;[^\n]*?&quot;)?\)/g, (all, text, url) =>
    (/^https?:\/\//i.test(url) ? tok(`<a href="${url}" target="_blank" rel="noopener noreferrer">${mdEmph(text)}</a>`) : text));
  if (MD_LINKS) s = plLinkify(s, tok);
  else s = s.replace(/\bhttps?:\/\/[^\s<&"]+[^\s<&".,;:!?)\]]/g, (url) => tok(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = mdEmph(s);
  const back = (t) => t.replace(/\u0000(\d+)\u0000/g, (_, n) => back(toks[n]));
  return back(s);
}

function mdEmph(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, "<del>$1</del>");
}

const mdLines = (lines) => mdInline(lines.join("\n")).replace(/\n/g, "<br>");

function mdCells(line) {
  const s = line.trim().replace(/^\|/, "").replace(/(^|[^\\])\|$/, "$1");
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function mdIsTable(lines, i) {
  return lines[i].includes("|") && i + 1 < lines.length && MD_TSEP.test(lines[i + 1]) && lines[i + 1].includes("-");
}

// 새 블록이 시작되는 줄인가(문단을 끊는 기준).
function mdStarts(lines, i) {
  const l = lines[i];
  return MD_FENCE.test(l) || MD_HEAD.test(l) || MD_HR.test(l) || MD_QUOTE.test(l) || MD_LIST.test(l) || mdIsTable(lines, i);
}

function mdTable(lines, i, out) {
  const head = mdCells(lines[i]);
  const align = mdCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : ""));
  const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${mdInline(c)}</${tag}>`;
  let html = `<thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>`;
  i += 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
    const row = mdCells(lines[i++]);
    html += `<tr>${head.map((_, k) => cell("td", row[k] ?? "", k)).join("")}</tr>`;
  }
  out.push(`<div class="mdtbl"><table>${html}</tbody></table></div>`);
  return i;
}

const mdListTag = (ordered, start, items) => {
  const tag = ordered ? "ol" : "ul";
  const st = ordered && start !== 1 ? ` start="${start}"` : "";
  return `<${tag}${st}>${items.map((it) => `<li>${mdLines(it.text)}${it.sub ? mdListTag(it.sub.ordered, it.sub.start, it.sub.items) : ""}</li>`).join("")}</${tag}>`;
};

// 목록: 기준 들여쓰기보다 2칸 이상 들어간 항목은 한 단계 아래로 모은다(그보다 깊어도 같은 단계).
function mdList(lines, i, out) {
  const first = MD_LIST.exec(lines[i]);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const nx = j < lines.length && MD_LIST.exec(lines[j]);
      if (nx && (nx[1].length > base + 1 || /\d/.test(nx[2]) === ordered)) { i = j - 1; continue; }
      break;
    }
    if (MD_FENCE.test(l)) break;
    const m = MD_LIST.exec(l);
    const last = items[items.length - 1];
    if (m && m[1].length <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ text: [m[3] || ""], sub: null });
    } else if (m && last) {
      const sub = last.sub || (last.sub = { ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, items: [] });
      sub.items.push({ text: [m[3] || ""] });
    } else if (last && /^\s+\S/.test(l)) {
      const tgt = last.sub ? last.sub.items[last.sub.items.length - 1] : last;
      tgt.text.push(l.trim());
    } else break;
  }
  out.push(mdListTag(ordered, parseInt(first[2], 10) || 1, items));
  return i;
}

function mdBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if ((m = MD_FENCE.exec(l))) {
      // 닫는 펜스가 아직 안 왔으면(스트리밍 중) 끝까지를 코드로 본다.
      const ind = m[1].length, mark = m[2][0], len = m[2].length, code = [];
      const close = new RegExp(`^\\s*${mark === "`" ? "`" : "~"}{${len},}\\s*$`);
      for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i].replace(new RegExp(`^ {0,${ind}}`), ""));
      i++;
      out.push(`<pre><code${m[3] ? ` data-lang="${esc(m[3])}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
    } else if ((m = MD_HEAD.exec(l))) {
      const n = Math.min(m[1].length, 3);
      out.push(`<h${n}>${mdInline(m[2])}</h${n}>`);
      i++;
    } else if (MD_HR.test(l)) {
      out.push("<hr>");
      i++;
    } else if (MD_QUOTE.test(l)) {
      const q = [];
      while (i < lines.length && MD_QUOTE.test(lines[i])) q.push(lines[i++].replace(MD_QUOTE, ""));
      out.push(`<blockquote>${mdBlocks(q)}</blockquote>`);
    } else if (mdIsTable(lines, i)) {
      i = mdTable(lines, i, out);
    } else if (MD_LIST.test(l)) {
      i = mdList(lines, i, out);
    } else {
      const p = [l];
      for (i++; i < lines.length && lines[i].trim() && !mdStarts(lines, i); i++) p.push(lines[i]);
      out.push(`<p>${mdLines(p)}</p>`);
    }
  }
  return out.join("");
}

function mdHTML(text, links = false) {
  MD_LINKS = links;
  try { return `<div class="md">${mdBlocks(String(text ?? "").replace(/\r\n?/g, "\n").split("\n"))}</div>`; } finally { MD_LINKS = false; }
}
