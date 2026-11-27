"use strict";

// 하나로 합친 관제 화면(웹·데스크톱 공통)의 Engineering HTTP 경계:
// Host 확인(DNS rebinding), 상태 변경 요청의 같은 출처 Origin, 서버 시작마다 만든 토큰, 웹 모드 GET·POST.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

function raw(port, route, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: route, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("engineering API works in web mode behind Host, Origin and per-start token checks", async (t) => {
  delete process.env.OMP_MAP_ENGINEERING_DATA;
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "omp-web-engineering-"));
  const logged = [];
  for (const name of ["log", "error", "warn"]) {
    const original = console[name];
    t.mock.method(console, name, (...args) => { logged.push(args.join(" ")); return original.call(console, ...args); });
  }
  try {
    await withLegacyHttp(t, async ({ config, directory }) => {
      const port = config.PORT;
      const { opsToken, HEADER } = require("../server/edge/ops-token");
      const token = opsToken();
      const same = `http://127.0.0.1:${port}`;
      const json = { "content-type": "application/json" };

      // 화면 셸에 토큰이 심겨 오고, 캐시하지 않는다. 다른 사이트는 이 응답을 읽을 수 없다(같은 출처 정책).
      const page = await raw(port, "/");
      assert.equal(page.status, 200);
      assert.equal(page.headers["cache-control"], "no-store");
      // 실패 메시지에 토큰이 찍히지 않게 불리언으로만 확인한다.
      assert.ok(page.text.includes(`<meta name="omp-ops-token" content="${token}">`), "token meta");
      assert.ok(page.text.includes('data-mode="tasks"'), "Task tab");
      assert.ok(page.text.includes('id="engineering"'), "Task panel");
      assert.ok(!page.text.includes("engineering.html"), "no separate page link");
      assert.ok(!page.text.includes("데스크톱에서 조회"), "no desktop-only notice");

      // 예전 Engineering 페이지 주소는 합친 화면의 탭으로 보낸다.
      const old = await raw(port, "/engineering.html?view=execution&project=p1");
      assert.equal(old.status, 302);
      assert.equal(old.headers.location, "/?mode=tasks&project=p1&view=execution");
      assert.equal((await raw(port, "/engineering.html?run=r1")).headers.location, "/?run=r1");
      assert.equal((await raw(port, "/engineering.html?view=studio")).headers.location, "/?mode=design");

      // DNS rebinding: 토큰이 있어도 Host 가 이 서버(127.0.0.1·localhost:<port>)가 아니면 거부한다.
      for (const host of [`evil.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`, `localhost.evil.example:${port}`]) {
        assert.equal((await raw(port, "/api/engineering/projects", { headers: { host, [HEADER]: token } })).status, 403, host);
        assert.equal((await raw(port, "/", { headers: { host } })).status, 403, host);
      }
      assert.equal((await raw(port, "/api/engineering/projects", { headers: { host: `localhost:${port}`, [HEADER]: token } })).status, 200);

      // 토큰 없음·틀린 토큰은 읽기와 쓰기 모두 거부한다(운영 API 도 같다).
      assert.equal((await raw(port, "/api/engineering/projects")).status, 403);
      assert.equal((await raw(port, "/api/engineering/projects", { headers: { [HEADER]: "0".repeat(token.length) } })).status, 403);
      assert.equal((await raw(port, "/api/engineering/projects/ensure", { method: "POST", headers: { ...json, origin: same },
        body: JSON.stringify({ root: folder }) })).status, 403);
      assert.equal((await raw(port, "/api/bg/start", { method: "POST", headers: { ...json, origin: same }, body: "{}" })).status, 403);

      // 다른 출처에서 온 상태 변경 요청은 토큰이 있어도 거부한다.
      for (const origin of ["https://example.invalid", "http://localhost:1", "null"]) {
        const denied = await raw(port, "/api/engineering/projects/ensure", { method: "POST",
          headers: { ...json, origin, [HEADER]: token }, body: JSON.stringify({ root: folder }) });
        assert.equal(denied.status, 403, origin);
      }
      assert.equal((await raw(port, "/api/engineering/teams", { method: "POST",
        headers: { ...json, "sec-fetch-site": "cross-site", [HEADER]: token }, body: JSON.stringify({ name: "x" }) })).status, 403);
      // 폼 전송처럼 JSON 이 아닌 POST 도 거부한다.
      assert.equal((await raw(port, "/api/engineering/teams", { method: "POST",
        headers: { "content-type": "text/plain", origin: same, [HEADER]: token }, body: "{}" })).status, 415);
      assert.deepEqual(JSON.parse((await raw(port, "/api/engineering/teams", { headers: { [HEADER]: token } })).text), []);

      // 같은 출처 화면의 요청(토큰 포함)은 웹 모드에서 읽기·쓰기가 된다. 데이터는 상태 폴더 아래 engineering/ 에 쌓인다.
      const browser = { origin: same, "sec-fetch-site": "same-origin", [HEADER]: token };
      const created = await raw(port, "/api/engineering/projects/ensure", { method: "POST", headers: { ...json, ...browser },
        body: JSON.stringify({ root: folder }) });
      assert.equal(created.status, 200, created.text);
      const project = JSON.parse(created.text);
      assert.equal(project.root, folder);
      const team = await raw(port, "/api/engineering/teams", { method: "POST", headers: { ...json, ...browser }, body: JSON.stringify({ name: "Web" }) });
      assert.equal(JSON.parse(team.text), "Web");
      const listed = JSON.parse((await raw(port, "/api/engineering/projects", { headers: browser })).text);
      assert.deepEqual(listed.map(({ id }) => id), [project.id]);
      const tasks = await raw(port, "/api/engineering/tasks?project=" + project.id, { headers: browser });
      assert.equal(tasks.status, 200);
      assert.deepEqual(JSON.parse(tasks.text), []);
      // 브라우저 밖(Origin 없음) 로컬 도구도 토큰이 있으면 쓸 수 있다.
      assert.equal((await raw(port, "/api/engineering/runtime", { headers: { [HEADER]: token } })).status, 200);
      await fs.access(path.join(directory, "state", "engineering", "engineering.sqlite"));
      assert.ok(logged.every((line) => !line.includes(token)), "the token is never logged");
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
