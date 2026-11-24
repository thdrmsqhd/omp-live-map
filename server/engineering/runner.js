"use strict";

const { problem, redact } = require("./state");

// Trust belongs to the host integration. A profile or an HTTP caller cannot grant it.
function secureRunner(adapters = new Map(), commands) {
  function requireAdapter(harness, model, checks) {
    const agent = adapters.get(harness.adapter);
    if (!agent?.enforced || !commands?.enforced) throw problem(409, "No verified isolation backend for this harness");
    if (!agent.supports(model, harness)) throw problem(409, "Model, reasoning or harness settings are unsupported");
    if (!checks.every((check) => commands.allows(check))) throw problem(409, "A verification command is outside the host allowlist");
    return agent;
  }
  return {
    available: (name) => Boolean(adapters.get(name)?.enforced && commands?.enforced),
    requireAdapter,
    async verify(checks, cwd, signal) {
      const results = [];
      for (const check of checks) {
        signal.throwIfAborted();
        const outcome = await commands.execute(check, cwd, signal);
        const result = { command: check.command, code: outcome.code, expected: check.code,
          passed: outcome.code === check.code, log: redact(outcome.log), elapsedMs: outcome.elapsedMs };
        results.push(result);
      }
      return results;
    },
  };
}

module.exports = { secureRunner };
