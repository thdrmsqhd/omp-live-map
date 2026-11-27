"use strict";

const { once } = require("node:events");
const { performance } = require("node:perf_hooks");
const { problem, redact } = require("./state");

// 프로그램 이름과 정확한 인자 목록은 호스트 설정(host-process.js 의 permitted)이 준다. 명령은 작업 폴더에서 실행한다.
function commandRunner(backend, allowlist) {
  const allowed = new Set(allowlist.map(({ command, args }) => JSON.stringify([command, args])));
  const allows = ({ command, args }) => allowed.has(JSON.stringify([command, args]));
  return {
    allows,
    enforced: backend.enforced === true,
    async execute(check, cwd, signal) {
      if (backend.enforced !== true || !allows(check)) throw problem(409, "Verification command is not allowed");
      signal.throwIfAborted();
      const start = performance.now();
      const child = backend.launch(check.command, check.args, {
        cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      }, { signal });
      const close = once(child, "close");
      const terminate = () => backend.terminate(child);
      signal.addEventListener("abort", terminate, { once: true });
      let log = "";
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (text) => { log = (log + text).slice(-16000); });
      }
      try {
        const [code, killed] = await close;
        signal.throwIfAborted();
        if (killed || !Number.isInteger(code)) throw new Error("Verification process ended without an exit code");
        return { code, log: redact(log), elapsedMs: Math.round(performance.now() - start) };
      } finally {
        signal.removeEventListener("abort", terminate);
      }
    },
  };
}

module.exports = { commandRunner };
