// HTTP 공용 헬퍼: JSON 응답, 요청 가드(Host·Origin·Sec-Fetch-Site·Content-Type), 본문 읽기·JSON 파싱(기본 1MB 상한).
"use strict";

const { PORT } = require("./config");

const MAX_BODY = 1024 * 1024;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const BAD_JSON = { ok: false, code: 1, out: "bad json" };

const json = (res, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": buf.length, "Cache-Control": "no-store" });
  res.end(buf);
};

const fail = (res, status, text) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
};

// 다른 사이트의 페이지·DNS rebinding에서 온 요청을 막는다. 거부 시 HTTP 상태 코드, 통과 시 0.
// 화면 자체(ui/ 정적 파일 GET)는 다른 곳의 링크로도 열 수 있어야 하므로 Host 만 확인한다.
function guardStatus(req) {
  if (!HOSTS.has(String(req.headers.host || "").toLowerCase())) return 403;
  if (req.method === "GET" && !String(req.url || "").startsWith("/api/")) return 0;
  const origin = req.headers.origin;
  if (origin !== undefined && !ORIGINS.has(origin)) return 403;
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return 403;
  if (req.method === "POST" && !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return 415;
  return 0;
}

// Connection: close라 응답을 다 쓴 뒤 소켓이 닫힌다. 남은 본문은 버린다.
function tooLarge(req, res) {
  res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
  res.end("payload too large");
  req.resume();
}

// 본문을 JSON 객체로 읽어 handler(payload)를 부른다. max(기본 1MB) 초과는 413, 파싱 실패는 BAD_JSON.
function withJson(req, res, handler, max = MAX_BODY) {
  if (Number(req.headers["content-length"] || 0) > max) return tooLarge(req, res);
  const chunks = [];
  let size = 0, over = false;
  req.on("data", (d) => {
    if (over) return;
    size += d.length;
    if (size > max) {
      over = true;
      tooLarge(req, res);
      return;
    }
    chunks.push(d);
  });
  req.on("end", () => {
    if (over) return;
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      return json(res, BAD_JSON);
    }
    if (!payload || typeof payload !== "object") return json(res, BAD_JSON);
    Promise.resolve()
      .then(() => handler(payload))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
}

module.exports = { json, fail, guardStatus, withJson };
