// 로컬 파일 미리보기: browser 블록이 C:\...\x.html 같은 로컬 html 을 iframe 으로 띄우게 한다.
// 주소는 /localfs/<토큰>/C%3A/dir/x.html 형태라 같은 폴더의 상대 경로(css·js·img)가 그대로 풀린다.
// 토큰은 서버를 켤 때 한 번 만들고 이 화면(같은 출처 GET /api/localfs)에만 알려 준다 — 다른 사이트는 주소를 짐작할 수 없다.
// 응답에 CSP sandbox 를 붙여 페이지가 불투명 출처가 된다: 페이지 스크립트는 이 화면의 /api 를 부를 수 없다.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MIME } = require("./config");
const { json, fail } = require("./edge/http");

const PREFIX = "/localfs/";
const BASE = PREFIX + crypto.randomBytes(16).toString("hex") + "/";
const WIN = process.platform === "win32";

// URL 경로의 나머지("C%3A/dir/x.html")를 정규화한 절대 파일 경로로 바꾼다. 형식이 틀리면 null.
function toFile(rest) {
  let segs;
  try {
    segs = rest.split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segs.some((s) => s.includes("\0"))) return null;
  const raw = WIN ? segs.join("\\") : "/" + segs.join("/");
  if (WIN && !/^[A-Za-z]:\\/.test(raw)) return null;
  return path.resolve(raw);
}

function serveLocal(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method not allowed");
  if (!url.pathname.startsWith(BASE)) return fail(res, 403, "forbidden");
  const file = toFile(url.pathname.slice(BASE.length));
  if (!file) return fail(res, 400, "bad path");
  fs.stat(file, (err, st) => {
    if (err) return fail(res, 404, "not found");
    // 폴더는 index.html 로 보낸다(주소 끝을 파일로 맞춰야 상대 경로가 그 폴더 기준으로 풀린다).
    if (st.isDirectory()) {
      res.writeHead(302, { Location: url.pathname.replace(/\/?$/, "/index.html"), "Cache-Control": "no-store" });
      return res.end();
    }
    if (!st.isFile()) return fail(res, 404, "not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals",
      // 불투명 출처 페이지의 모듈 스크립트·fetch 가 같은 폴더 파일을 읽을 수 있게 한다(주소는 토큰이 지킨다).
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
}

module.exports = {
  PREFIX,
  serveLocal,
  routes: { "GET /api/localfs": (req, res) => json(res, { base: BASE }) },
};
