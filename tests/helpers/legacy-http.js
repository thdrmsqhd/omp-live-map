"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const OPS_HEADER = "x-omp-ops-token";

async function withLegacyHttp(t, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-map-test-"));
  const originalState = process.env.OMP_MAP_STATE;
  process.env.OMP_MAP_STATE = path.join(directory, "state");
  const home = t.mock.method(os, "homedir", () => directory);
  let handle;
  const server = http.createServer((req, res) => handle(req, res));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const config = require("../../server/config");
    config.PORT = server.address().port;
    ({ handle } = require("../../server/routes"));
    await run({
      directory,
      config,
      request: (route, options = {}) => request(config.PORT, route, options),
    });
  } finally {
    home.mock.restore();
    if (originalState === undefined) delete process.env.OMP_MAP_STATE;
    else process.env.OMP_MAP_STATE = originalState;
    if (server.listening) {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
    // 세션 하네스 배정 저장소(SQLite)를 연 테스트가 있으면 Windows 에서 폴더를 지우기 전에 닫아야 한다.
    require("../../server/harness/session-harness").close();
    require("../../server/routes").closeEngineering?.();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

// 화면처럼 운영 API 토큰을 기본으로 붙인다. opsToken: false 면 빼고 보낸다.
function request(port, route, { method = "GET", headers = {}, body, frames = 0, opsToken = true }) {
  if (opsToken) headers = { [OPS_HEADER]: require("../../server/edge/ops-token").opsToken(), ...headers };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: route, method, headers }, (res) => {
      let text = "";
      const result = () => ({ status: res.statusCode, headers: res.headers, text });
      res.setEncoding("utf8");
      res.on("error", reject);
      res.on("data", (chunk) => {
        text += chunk;
        if (!frames) return;
        const parts = text.split("\n\n");
        if (parts.length <= frames) return;
        text = parts.slice(0, frames).join("\n\n");
        resolve(result());
        res.destroy();
      });
      res.on("end", () => resolve(result()));
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error(`Timed out: ${route}`)));
    req.end(body);
  });
}

module.exports = { withLegacyHttp };
