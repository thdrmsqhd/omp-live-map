/* omp-live-map · core · 표시 형식 유틸 (DOM·상태 접근 없음) */

const fmt = (n) => !n ? "0" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);

// 돈: 화면은 어디서나 원화 한 단위(₩)다. 환율 FX = 서버 OMP_USD_KRW(기본 1390, core/state.js · store.js 가 받는다).
// 저장·계산은 그대로 USD(비용) · 센트(예산)이고, 화면에서 고친 ₩ 값은 저장 전에 센트로 되돌린다.
const won = (v) => "₩" + Math.round(+v || 0).toLocaleString("ko-KR");
const krw = (usd) => won((+usd || 0) * FX);
const krwCents = (cents) => krw((+cents || 0) / 100);
const wonOfCents = (cents) => Math.round((+cents || 0) / 100 * FX);
// 입력한 원화(쉼표·₩·'원' 허용) → 센트. 숫자가 아니면 NaN.
const centsOfWon = (text) => {
  const n = Number(String(text ?? "").replace(/[₩,\s원]/g, ""));
  return String(text ?? "").trim() && Number.isFinite(n) ? Math.round(n / FX * 100) : NaN;
};

const ago = (ts) => {
  if (!ts) return "-";
  const d = Date.now() - ts;
  if (d < 60000) return Math.max(1, Math.round(d / 1000)) + "초 전";
  if (d < 3600000) return Math.round(d / 60000) + "분 전";
  if (d < 86400000) return Math.round(d / 3600000) + "시간 전";
  return Math.round(d / 86400000) + "일 전";
};

// 경과 시간: 12초 / 3분 04초 / 1시간 12분
const dur = (ms) => {
  const s = Math.max(0, Math.round((+ms || 0) / 1000));
  if (s < 60) return s + "초";
  if (s < 3600) return Math.floor(s / 60) + "분 " + String(s % 60).padStart(2, "0") + "초";
  return Math.floor(s / 3600) + "시간 " + Math.floor((s % 3600) / 60) + "분";
};

const modelShort = (m) => String(m || "?").split("/").pop();

const cut = (s, n) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

const memSize = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2) + "GB" : mb + "MB");
