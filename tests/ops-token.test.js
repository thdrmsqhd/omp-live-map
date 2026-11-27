"use strict";

// 운영 API 는 화면에 심긴 토큰이 있어야 부를 수 있다. 조회 경로와 화면 셸은 그대로다.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");
const { opsToken } = require("../server/edge/ops-token");

const MUTATING = ["/api/exec", "/api/bg/start", "/api/bg/stop", "/api/release", "/api/infra/action", "/api/db/query"];

// 서버 설정(PORT)이 모듈 적재 때 고정되므로 HTTP 서버 하나에서 모두 확인한다.
test("mutating ops routes need the ops token; the screen carries it; reads stay open", (t) =>
  withLegacyHttp(t, async ({ request }) => {
    for (const route of MUTATING) {
      const denied = await request(route, {
        method: "POST", opsToken: false,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: "echo should-not-run" }),
      });
      assert.equal(denied.status, 403, route);
      assert.equal(JSON.parse(denied.text).ok, false, route);
      const wrong = await request(route, {
        method: "POST", opsToken: false,
        headers: { "content-type": "application/json", "x-omp-ops-token": "0".repeat(64) }, body: "{}",
      });
      assert.equal(wrong.status, 403, route);
    }
    const stop = await request("/api/bg/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(stop.status, 200, "the token the screen carries is accepted");

    // 화면 셸은 토큰을 품고, 조회 경로는 토큰 없이도 열린다.
    const page = await request("/", { opsToken: false });
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`<meta name="omp-ops-token" content="${opsToken()}">`));
    assert.equal((await request("/api/bg/all", { opsToken: false })).status, 200);
  }));
