// 채팅 이미지 게으른 서빙: GET /api/img/<id>.
//   <64hex>    ~/.omp/agent/blobs/<hash>
//   i<64hex>   JSONL 에 직접 실린 base64 (메모리)
//   u<base64url> %TEMP%\omp-live-map-uploads 안의 첨부 파일(신뢰 루트 밖 거부)
// 경로가 고정·내용 주소라 응답을 오래 캐시해도 안전하다. 크기 상한 없이 스트리밍하고,
// 실제 바이트가 허용 이미지 형식일 때만 내보낸다(임의 파일 노출 방지).
"use strict";

const fs = require("fs");
const { fail } = require("./http");
const { sniff, blobFile, inlineOf, uploadFile } = require("./images");

const PREFIX = "/api/img/";
const ID = /^i?[a-f0-9]{64}$/;
const UPLOAD_ID = /^u[A-Za-z0-9_-]{1,2000}$/;
const CACHE = "public, max-age=31536000, immutable";

// 검증된 파일 하나를 헤더와 함께 보낸다. 이미지 형식이 아니면 404.
function sendFile(req, res, file) {
  let st, head;
  try {
    const fd = fs.openSync(file, "r");
    try {
      st = fs.fstatSync(fd);
      if (!st.isFile()) return fail(res, 404, "not found");
      head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return fail(res, 404, "not found");
  }
  const mime = sniff(head);
  if (!mime) return fail(res, 404, "not found");
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": st.size,
    "Cache-Control": CACHE,
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function serve(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method not allowed");
  const id = url.pathname.slice(PREFIX.length);
  if (id[0] === "u") {
    if (!UPLOAD_ID.test(id)) return fail(res, 404, "not found");
    const file = uploadFile(id);
    return file ? sendFile(req, res, file) : fail(res, 404, "not found");
  }
  if (!ID.test(id)) return fail(res, 404, "not found");
  if (id[0] === "i") {
    const it = inlineOf(id);
    if (!it) return fail(res, 404, "not found");
    res.writeHead(200, {
      "Content-Type": it.mime,
      "Content-Length": it.buf.length,
      "Cache-Control": CACHE,
      "X-Content-Type-Options": "nosniff",
    });
    return req.method === "HEAD" ? res.end() : res.end(it.buf);
  }
  const file = blobFile(id);
  return file ? sendFile(req, res, file) : fail(res, 404, "not found");
}

module.exports = { PREFIX, serve };
