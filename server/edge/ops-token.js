"use strict";

// 운영 API(셸 실행·잡·프로세스 종료·인프라 조작·DB 조회)용 토큰.
// 기존 가드(Host·Origin·Sec-Fetch-Site·Content-Type)는 브라우저 밖에서 온 요청을 막지 못한다.
// 화면은 index.html 에 심긴 토큰을 헤더로 돌려보내고, 그 밖의 로컬 프로세스는 토큰 없이 부를 수 없다.
const { randomBytes, timingSafeEqual } = require("node:crypto");

const HEADER = "x-omp-ops-token";
const token = process.env.OMP_MAP_OPS_TOKEN || randomBytes(32).toString("hex");
delete process.env.OMP_MAP_OPS_TOKEN;

function opsToken() {
  return token;
}

function opsAllowed(req) {
  const supplied = Buffer.from(String(req.headers[HEADER] ?? ""));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// handler 를 감싸 토큰이 맞을 때만 부른다.
function requireOps(handler) {
  return (req, res, url) => {
    if (opsAllowed(req)) return handler(req, res, url);
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: false, error: "ops token required", out: "운영 API 토큰이 없습니다. 화면을 새로 고쳐 주세요." }));
  };
}

// 화면 셸에 토큰을 심는다. 같은 출처 페이지만 이 응답을 읽을 수 있다.
function injectOpsToken(html) {
  return html.replace(/<meta charset="utf-8">/i, (meta) => `${meta}\n<meta name="omp-ops-token" content="${token}">`);
}

module.exports = { HEADER, opsToken, opsAllowed, requireOps, injectOpsToken };
