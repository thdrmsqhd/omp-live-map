"use strict";

const { problem, redact } = require("./state");

// 실행기와 검증 명령 허용 목록은 호스트 조립(runtime.js)이 정한다. 프로필이나 HTTP 요청이 늘릴 수 없다.
function secureRunner(adapters = new Map(), commands) {
  function requireAdapter(harness, model, checks) {
    const agent = adapters.get(harness.adapter);
    if (!agent?.enforced || !commands?.enforced) throw problem(409, "이 하네스를 실행할 실행기(omp·claude CLI)를 이 PC에서 찾지 못했습니다");
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
