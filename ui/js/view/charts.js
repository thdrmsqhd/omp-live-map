/* omp-live-map · view · 토큰 테이프와 스파크라인 SVG */

const TOK_COLORS = [["input", "#4aa8ff"], ["output", "#2fbf9b"], ["cacheRead", "#5f7a92"], ["cacheWrite", "#a98bff"]];
const TOK_LABELS = { input: "입력", output: "출력", cacheRead: "캐시읽기", cacheWrite: "캐시쓰기" };

function tokTotal(t) {
  return (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
}

// 0 < p < 1% 는 "<1%" 로 보여 0 과 구분한다.
function pctText(v, total) {
  if (!v || !total) return "0%";
  const p = (v / total) * 100;
  return p < 1 ? "<1%" : Math.round(p) + "%";
}

function tokenTape(t) {
  const sum = tokTotal(t);
  const total = Math.max(1, sum);
  return TOK_COLORS.map(([k, c]) => {
    const v = t[k] || 0;
    return v ? `<i data-seg="${k}" title="${TOK_LABELS[k]} ${fmt(v)} (${pctText(v, sum)})" style="width:${(v / total) * 100}%;background:${c}"></i>` : "";
  }).join("");
}

function tokenLegend(t) {
  const sum = tokTotal(t);
  const rows = [["입력", t.input], ["출력", t.output], ["캐시읽기", t.cacheRead], ["캐시쓰기", t.cacheWrite]];
  const cls2 = ["m-tok", "m-out", "m-cache", "m-req"];
  return `<div class="nums" style="font-size:10.5px;gap:10px">${rows.map(([n, v], i) => `<u class="${cls2[i]}">${n} <b>${fmt(v || 0)}</b><small>${pctText(v, sum)}</small></u>`).join("")}</div>`;
}

// id 가 있으면 data-spark 로 카드를 식별한다. data-pts 는 크로스헤어(spark-hover.js)가 읽는다.
function spark(series, w, h, color, fill, id) {
  const pts = (series || []).filter((s) => s && typeof s.out === "number");
  if (pts.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const max = Math.max(...pts.map((p) => p.out), 1);
  const step = w / (pts.length - 1);
  const xy = pts.map((p, i) => [(i * step).toFixed(1), (h - 2 - (p.out / max) * (h - 4)).toFixed(1)]);
  const path = xy.map((p) => p.join(",")).join(" ");
  const last = xy[xy.length - 1];
  const data = JSON.stringify(pts.map((p) => ({ ts: p.ts || 0, out: p.out, dur: p.dur || 0 })));
  return `<svg class="spark"${id ? ` data-spark="${esc(id)}"` : ""} data-pts='${data}' data-max="${max}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${path}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>
    ${fill ? `<polygon points="0,${h} ${path} ${w},${h}" fill="${color}" opacity="0.13"/>` : ""}
    <circle class="sp-last" cx="${last[0]}" cy="${last[1]}" r="2.2" fill="${color}"/></svg>`;
}

// 값 배열만으로 그리는 작은 추세선(자원 행의 최근 CPU). 세로축은 0~max(100, 최댓값).
function miniSpark(values, w, h, color) {
  const v = (values || []).filter((x) => typeof x === "number");
  if (v.length < 2) return "";
  const max = Math.max(100, ...v);
  const step = w / (v.length - 1);
  const path = v.map((x, i) => `${(i * step).toFixed(1)},${(h - 1 - (x / max) * (h - 2)).toFixed(1)}`).join(" ");
  return `<svg class="mini" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${path}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}
