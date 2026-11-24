"use strict";

const { once } = require("node:events");
const { performance } = require("node:perf_hooks");
const { problem, redact } = require("./state");

// Program names and exact argument vectors are supplied by trusted host configuration.
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
