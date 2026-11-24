"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { dockerRunner } = require("./docker-runner");
const { consoleOAuth } = require("./anthropic-oauth");
const { secureRunner } = require("./runner");
const { problem } = require("./state");

const tag = "omp-live-map-runtime:v2.1";
const execute = promisify(execFile);
const isolatedEnv = { ...process.env };
for (const name of Object.keys(isolatedEnv)) {
  if (/^(docker_|anthropic_|omp_map_engineering_token)/i.test(name)) delete isolatedEnv[name];
}

function localDocker() {
  const windows = process.platform === "win32";
  const binary = windows ? path.join(process.env.ProgramFiles || "C:\\Program Files",
    "Docker", "Docker", "resources", "bin", "docker.exe") : "/usr/bin/docker";
  if (!fs.existsSync(binary)) throw problem(409, "Docker Desktop with the Linux engine is required");
  return { binary, context: windows ? "desktop-linux" : "default" };
}

function runtime(directory, key, auth = consoleOAuth()) {
  let status = "unchecked";
  let detail = "런타임 확인이 필요합니다.";
  let delegate = secureRunner();
  let pending;
  let loginAttempt;
  let loginStatus = "";
  const runners = new Set();
  async function discover(build) {
    const { binary, context } = localDocker();
    const run = (options, args, timeout = 10000) => execute(binary, [...options, ...args],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: isolatedEnv });
    const result = await run(["--context", context], ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
    const expected = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
    if (result.stdout.trim() !== expected) throw problem(409, "Docker context does not point to the local Linux engine");
    if (build) await run(["--host", expected], ["build", "--tag", tag, path.join(__dirname, "docker")], 900000);
    const inspected = await run(["--host", expected], ["image", "inspect", tag, "--format", '{{.Id}} {{index .Config.Labels "dev.omplivemap.runtime"}}']);
    const [image, label] = inspected.stdout.trim().split(/\s+/);
    if (label !== "engine-v2.1") throw problem(409, "The approved runtime image could not be identified");
    const workspaceRoot = path.join(directory, "worktrees");
    fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
    const apiKey = key;
    let oauth;
    if (auth) {
      try { await auth.accessToken(); oauth = auth.accessToken; } catch {}
    }
    delegate = dockerRunner({ image, context, binary, workspaceRoot, key: oauth ? null : apiKey, oauth, daemon: expected });
    runners.add(delegate);
    status = apiKey || oauth ? "ready" : "missing-key";
    detail = oauth ? "격리 런타임 사용 가능 · Claude Console OAuth" : apiKey
      ? "격리 런타임 사용 가능 · Anthropic API 키"
      : "Claude Console에 로그인하거나 Anthropic API 키를 저장해 주세요.";
  }
  function prepare(build = false) {
    if (pending) return pending;
    status = build ? "building" : "checking";
    detail = build ? "격리 런타임 이미지를 준비하는 중입니다." : "로컬 Docker 런타임을 확인하는 중입니다.";
    pending = discover(build).catch((error) => {
      delegate = secureRunner();
      status = "unavailable";
      detail = error.status ? error.message : build
        ? "런타임 이미지 준비에 실패했습니다. Docker의 실행 상태와 이미지 빌드 연결을 확인해 주세요."
        : "로컬 Linux Docker 엔진과 준비된 런타임 이미지가 필요합니다.";
    }).finally(() => { pending = null; });
    return pending;
  }
  function refresh() {
    if (pending) void pending.then(() => prepare());
    else void prepare();
  }
  async function completeLogin(attempt) {
    const { signal } = attempt;
    try {
      await auth.login(signal);
      await auth.accessToken(signal);
      signal.throwIfAborted();
      loginStatus = "Claude Console에 연결되었습니다.";
      refresh();
    } catch {
      loginStatus = signal.aborted ? "Claude Console 로그인을 취소했습니다."
        : "Claude Console 로그인에 실패했습니다. 브라우저에서 로그인을 완료한 뒤 다시 시도해 주세요.";
    } finally {
      loginAttempt = null;
    }
  }
  return {
    available: (name) => delegate.available(name),
    requireAdapter: (...args) => delegate.requireAdapter(...args),
    verify: (...args) => delegate.verify(...args),
    prepare,
    snapshot: () => delegate,
    login(cancel) {
      if (cancel) { loginAttempt?.abort(); return; }
      if (loginAttempt) return;
      if (!auth) throw problem(409, "Claude Console 로그인 도구를 찾을 수 없습니다.");
      loginAttempt = new AbortController();
      loginStatus = "브라우저에서 Claude Console 로그인을 완료해 주세요.";
      void completeLogin(loginAttempt);
    },
    setKey(value) {
      key = typeof value === "string" ? value : null;
      refresh();
    },
    shutdown() {
      loginAttempt?.abort();
      for (const active of runners) active.shutdown();
    },
    status: () => ({ status, detail, canLogin: Boolean(auth), signingIn: Boolean(loginAttempt), loginStatus,
      omp: delegate.available("omp"), claude: delegate.available("claude") }),
  };
}

module.exports = { runtime };
