"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { dockerRunner } = require("../infrastructure/docker");
const { consoleOAuth } = require("./anthropic-oauth");
const { claudeCodeLogin, savedToken, LOGIN_EXPIRED } = require("./claude-code-oauth");
const { secureRunner } = require("./runner");
const { problem } = require("./state");

const tag = "omp-live-map-runtime:v2.2";
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

// 준비된 실행 환경이 Claude Code 로그인을 쓰면 로그인 파일을 다시 읽어 만료 시각을 갱신하고, 만료됐으면 그 상태를 돌려준다.
function liveAuthState(status, auth, claudeCode) {
  if (status !== "ready" || auth?.kind !== "claude-code-login" || !claudeCode) return null;
  try {
    const { expiresAt } = claudeCode.describe();
    auth.expiresAt = Number.isFinite(expiresAt) ? expiresAt : null;
    return null;
  } catch (error) {
    return { status: error.code === LOGIN_EXPIRED ? "login-expired" : "missing-key", detail: error.message };
  }
}
// 인증 우선순위: Claude Console OAuth → 저장한 Claude Code 토큰(setup-token) → Claude Code 로그인(구독) → Anthropic API 키.
// claudeCode 에 null 을 넘기면 Claude Code 로그인을 보지 않는다(테스트·다른 사용자 데이터 격리용).
function runtime(directory, key, consoleAuth = consoleOAuth(), claudeCode = process.env.OMP_MAP_CLAUDE_CODE_AUTH === "0" ? null : claudeCodeLogin()) {
  let status = "unchecked";
  let detail = "런타임 확인이 필요합니다.";
  let delegate = secureRunner();
  let pending;
  let loginAttempt;
  let loginStatus = "";
  // 지금 쓰는 인증 수단. billing: subscription(구독 한도에서 차감) 또는 api(사용량 청구). 토큰은 담지 않는다.
  let auth = null;
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
    if (label !== "engine-v2.2") throw problem(409, "The approved runtime image could not be identified");
    const workspaceRoot = path.join(directory, "worktrees");
    fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
    const token = savedToken(key);
    const apiKey = token ? null : key;
    let oauth, source = "", claudeCodeNote = "", kind = "";
    if (consoleAuth) {
      try { await consoleAuth.accessToken(); oauth = consoleAuth.accessToken; source = "Claude Console OAuth"; kind = "console"; } catch {}
    }
    if (!oauth && token) { oauth = token; source = "Claude Code 토큰(setup-token)"; kind = "claude-code-token"; }
    let expiresAt = null;
    if (!oauth && claudeCode) {
      try {
        const { plan, expiresAt: until } = claudeCode.describe();
        oauth = claudeCode.accessToken;
        source = "Claude Code 로그인" + (plan ? " (" + plan + " 구독)" : "");
        kind = "claude-code-login";
        expiresAt = Number.isFinite(until) ? until : null;
      } catch (error) {
        claudeCodeNote = error.message;
        // 만료된 로그인도 다른 인증이 없으면 그대로 두고 상태에서 만료를 알린다.
        // Claude Code 가 갱신하면 다시 확인하지 않아도 다음 상태 조회부터 준비됨으로 돌아온다.
        if (error.code === LOGIN_EXPIRED && !apiKey) { oauth = claudeCode.accessToken; source = "Claude Code 로그인"; kind = "claude-code-login"; }
      }
    }
    delegate = dockerRunner({ image, context, binary, workspaceRoot, key: oauth ? null : apiKey, oauth, daemon: expected });
    runners.add(delegate);
    if (!kind && apiKey) kind = "api-key";
    auth = kind ? { kind, source: source || "Anthropic API 키", billing: kind.startsWith("claude-code") ? "subscription" : "api", expiresAt } : null;
    status = apiKey || oauth ? "ready" : "missing-key";
    detail = oauth ? "격리 런타임 사용 가능 · " + source : apiKey
      ? "격리 런타임 사용 가능 · Anthropic API 키"
      : "Claude Code에 로그인하거나, Claude Console에 로그인하거나, Anthropic API 키나 Claude Code 토큰을 저장해 주세요." +
        (claudeCodeNote ? " (" + claudeCodeNote + ")" : "");
  }
  // Claude Code 로그인은 몇 시간마다 만료되므로 상태를 물을 때마다 로그인 파일을 다시 읽는다(실행 시작 전 검사도 이 상태를 쓴다).
  const liveAuth = () => liveAuthState(status, auth, claudeCode);
  function prepare(build = false) {
    if (pending) return pending;
    status = build ? "building" : "checking";
    detail = build ? "격리 런타임 이미지를 준비하는 중입니다." : "로컬 Docker 런타임을 확인하는 중입니다.";
    pending = discover(build).catch((error) => {
      delegate = secureRunner();
      auth = null;
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
      await consoleAuth.login(signal);
      await consoleAuth.accessToken(signal);
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
      if (!consoleAuth) throw problem(409, "Claude Console 로그인 도구를 찾을 수 없습니다.");
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
    status: () => {
      const live = liveAuth();
      return { status: live?.status ?? status, detail: live?.detail ?? detail, canLogin: Boolean(consoleAuth), signingIn: Boolean(loginAttempt), loginStatus,
        auth: auth && { ...auth }, omp: delegate.available("omp"), claude: delegate.available("claude") };
    },
  };
}

module.exports = { runtime, liveAuthState };
