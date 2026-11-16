// 사용자 메시지 이미지: JSONL 의 이미지 블록(blob:sha256:<hash>·data URL·base64)을
// 스냅샷 계약 { mime, url } 로 바꾼다. 실제 바이트는 GET /api/img/<id> 가 스트리밍한다.
// blob 실체는 ~/.omp/agent/blobs/<hash>, JSONL 에 직접 실린 base64 는 이 모듈이 메모리에 보관한다.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { BLOBS, UPLOADS } = require("./config");

// UI 가 표시할 수 있는 형식만 통과시킨다.
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const HASH = /^[a-f0-9]{64}$/;
const INLINE_MAX = 24 * 1024 * 1024; // JSONL 에 직접 실린 base64 상한(업로드 20MB 수용)
const INLINE_CACHE = 64 * 1024 * 1024; // 메모리 보관 inline 이미지 합계 상한

const inline = new Map(); // "i<sha256>" -> { mime, buf }
let inlineBytes = 0;

// 파일 머리 바이트로 실제 형식을 확인한다(블록의 mimeType 이 없거나 허용 밖일 때).
function sniff(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

const normMime = (s) => String(s || "").toLowerCase().replace(/\s/g, "");

// JSONL 에 직접 실린 base64 이미지를 메모리에 남기고 내용 주소 id 를 돌려준다.
function rememberInline(mime, data) {
  let buf;
  try {
    buf = Buffer.from(data, "base64");
  } catch {
    return null;
  }
  if (!buf.length) return null;
  const m = sniff(buf) || (ALLOWED.has(mime) ? mime : "");
  if (!m) return null;
  const id = "i" + crypto.createHash("sha256").update(buf).digest("hex");
  if (inline.has(id)) return { mime: inline.get(id).mime, url: "/api/img/" + id };
  inline.set(id, { mime: m, buf });
  inlineBytes += buf.length;
  while (inlineBytes > INLINE_CACHE && inline.size > 1) {
    const [k, v] = inline.entries().next().value;
    inline.delete(k);
    inlineBytes -= v.buf.length;
  }
  return { mime: m, url: "/api/img/" + id };
}

// 이미지 블록 하나 -> 내부 참조 { mime, hash } | { mime, url } | null.
// messages 에는 이 참조만 담고, 스냅샷에서 { mime, url } 로 바꾼다.
function imageRef(c) {
  if (!c || c.type !== "image") return null;
  const src = c.source && typeof c.source === "object" ? c.source : null;
  const mime = normMime(c.mimeType || c.mime || (src && src.media_type));
  let raw = c.data || c.url || (src && src.data) || "";
  if (typeof raw !== "string" || !raw) return null;
  const blob = /^blob:sha256:([a-f0-9]{64})$/.exec(raw);
  if (blob) return { mime, hash: blob[1] };
  const url = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(raw);
  if (url) {
    const m = normMime(url[1]);
    return ALLOWED.has(m) && url[2].length <= INLINE_MAX ? rememberInline(m, url[2]) : null;
  }
  // 형식이 붙은 base64 만 받는다(평문 텍스트와 구분).
  if (!ALLOWED.has(mime) || raw.length > INLINE_MAX) return null;
  raw = raw.replace(/\s/g, "");
  return /^[A-Za-z0-9+/]+={0,2}$/.test(raw.slice(0, 128)) ? rememberInline(mime, raw) : null;
}

// 내부 참조 -> 스냅샷 계약 { mime, url }. blob 은 게으른 URL, inline 은 이미 URL 이다.
function publicRef(ref) {
  if (!ref) return null;
  if (ref.url) return { mime: ref.mime, url: ref.url };
  if (HASH.test(ref.hash || "")) return { mime: ref.mime, url: "/api/img/" + ref.hash };
  return null;
}

// 노드 messages 의 _imgs(내부 참조)를 images [{mime,url}] 로 바꾼다. 바이트 예산은 없다(게으른 로드).
function attachImages(list) {
  for (const s of list) {
    for (const n of s.nodes) {
      for (const m of n.messages || []) {
        if (!m._imgs) continue;
        const imgs = m._imgs.map(publicRef).filter(Boolean);
        delete m._imgs;
        if (imgs.length) m.images = imgs;
      }
    }
  }
}

// blob id -> 실제 파일 경로. 없으면 "". 확장자 없는 파일이 기본이고 .webp/.png 사본도 있다.
function blobFile(hash) {
  if (!HASH.test(hash)) return "";
  for (const name of [hash, hash + ".webp", hash + ".png", hash + ".jpg", hash + ".jpeg"]) {
    const p = path.join(BLOBS, name);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* 다음 후보 */
    }
  }
  return "";
}

const inlineOf = (id) => inline.get(id) || null;

// 프롬프트 첨부(uploads.js)가 남긴 "%TEMP%\omp-live-map-uploads\..." 경로를 이미지 URL 로 바꾼다.
// 업로드 루트 밖 경로·이미지 확장자 아닌 경로는 이미지가 아니다.
const UPLOAD_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const ROOT = path.resolve(UPLOADS);

function uploadRef(p) {
  if (typeof p !== "string" || !p || p.length > 1024) return null;
  let abs;
  try {
    abs = path.resolve(p);
  } catch {
    return null;
  }
  const rel = path.relative(ROOT, abs);
  // ".." 시작·절대 경로(다른 드라이브)는 루트 밖이다.
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const mime = UPLOAD_MIME[path.extname(abs).toLowerCase()];
  if (!mime) return null;
  const id = Buffer.from(rel.split(path.sep).join("/")).toString("base64url");
  return id ? { mime, url: "/api/img/u" + id } : null;
}

// 메시지 본문의 "- <경로>" 줄에서 신뢰 루트 안 이미지 경로만 골라 중복 없이 참조로 만든다.
function textRefs(text) {
  if (typeof text !== "string" || text.indexOf("- ") < 0) return [];
  const out = [];
  const seen = new Set();
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("- ")) continue;
    const ref = uploadRef(s.slice(2).replace(/^["']|["']$/g, "").trim());
    if (ref && !seen.has(ref.url)) {
      seen.add(ref.url);
      out.push(ref);
    }
  }
  return out;
}

// /api/img/u<base64url> -> 실제 파일. 신뢰 루트 안의 일반 파일만, 심볼릭 링크 이탈도 막는다.
function uploadFile(id) {
  if (typeof id !== "string" || id.length < 2 || id.length > 2000 || id[0] !== "u") return "";
  const b64 = id.slice(1);
  let rel;
  try {
    rel = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return "";
  }
  // 정규형만 받는다(다른 인코딩으로 같은 경로를 우회하지 못하게).
  if (!rel || Buffer.from(rel, "utf8").toString("base64url") !== b64) return "";
  const segs = rel.split("/");
  if (!segs.length || segs.some((s) => !s || s === "." || s === ".." || s.includes("\\") || s.includes(":") || s.includes("\0"))) return "";
  let realRoot, real;
  try {
    realRoot = fs.realpathSync(ROOT);
    real = fs.realpathSync(path.join(realRoot, ...segs));
  } catch {
    return "";
  }
  if (!real.startsWith(realRoot + path.sep)) return "";
  try {
    return fs.statSync(real).isFile() ? real : "";
  } catch {
    return "";
  }
}

module.exports = { ALLOWED, sniff, imageRef, publicRef, attachImages, blobFile, inlineOf, textRefs, uploadFile };
