"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

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
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function request(port, route, { method = "GET", headers = {}, body, frames = 0 }) {
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
