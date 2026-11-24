"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { EventEmitter, once } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { createInterface } = require("node:readline");
const { createAnthropicBroker, models } = require("./anthropic");
const { adaptersFor } = require("./adapters");
const { commandRunner } = require("./command-runner");
const { secureRunner } = require("./runner");
const { problem } = require("./state");

const permitted = [
  { command: "npm", args: ["test"] }, { command: "node", args: ["--test"] },
  { command: "python3", args: ["-m", "unittest", "discover"] },
];
const bridgeFile = "/usr/local/lib/omp-engineering/bridge.cjs";

function bridgeProcess(raw, broker, abort) {
  const channel = new EventEmitter();
  channel.stdout = new PassThrough();
  channel.stderr = new PassThrough();
  channel.exitCode = null;
  channel.signalCode = null;
  channel.cost = () => broker.spent();
  channel.stdin = new Writable({
    write(chunk, _, done) { transmit({ kind: "input", data: chunk.toString("base64") }, done); },
    final(done) { transmit({ kind: "input-end" }, done); },
  });
  channel.stdin.on("error", () => {});
  raw.stdin.on("error", () => {});
  channel.kill = abort;

  function transmit(frame, done) {
    if (raw.stdin.destroyed) { done?.(); return false; }
    return raw.stdin.write(JSON.stringify(frame) + "\n", done);
  }
  async function reply(request) {
    try {
      const response = await broker.request(request);
      const type = response.headers.get("content-type")?.split(";")[0];
      transmit({ kind: "headers", id: request.id, status: response.status,
        type: type === "text/event-stream" ? type : "application/json" });
      // Treat the provider body as opaque for the CLI. Only fixed upstream URLs are consulted.
      let written = 0;
      if (response.body) for await (const piece of response.body) {
        written += piece.length;
        if (written > 16 * 1024 * 1024) throw new Error("Provider response exceeded the limit");
        if (!transmit({ kind: "data", id: request.id, data: Buffer.from(piece).toString("base64") }) &&
            !raw.stdin.destroyed) await once(raw.stdin, "drain");
      }
    } catch {
      transmit({ kind: "headers", id: request.id, status: 400, type: "application/json" });
      const error = JSON.stringify({ type: "error", error: { type: "invalid_request_error",
        message: "The local model broker denied or could not complete the request" } });
      transmit({ kind: "data", id: request.id, data: Buffer.from(error).toString("base64") });
    } finally {
      transmit({ kind: "end", id: request.id });
    }
  }

  const lines = createInterface({ input: raw.stdout });
  lines.on("line", (line) => {
    let frame;
    try { frame = JSON.parse(line); } catch { abort(); return; }
    if (frame.kind === "request") void reply(frame);
    if (frame.kind === "stdout") channel.stdout.write(Buffer.from(frame.data, "base64"));
    if (frame.kind === "stderr") channel.stderr.write(Buffer.from(frame.data, "base64"));
  });
  raw.stderr.pipe(channel.stderr, { end: false });
  raw.once("error", (error) => channel.emit("error", error));
  raw.once("close", (code, signal) => {
    channel.exitCode = code;
    channel.signalCode = signal;
    channel.stdout.end();
    channel.stderr.end();
    channel.emit("close", code, signal);
  });
  return channel;
}

function dockerRunner({ image, context, binary, workspaceRoot, key, daemon, upstream, launchProcess = spawn }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !path.isAbsolute(binary) ||
      !["default", "desktop-linux"].includes(context)) throw problem(409, "A local Docker runtime and immutable image are required");
  const root = fs.realpathSync(workspaceRoot);
  const env = { ...process.env };
  for (const variable of Object.keys(env)) {
    if (/^(docker_|anthropic_|omp_map_engineering_token)/i.test(variable)) delete env[variable];
  }
  const prefix = daemon ? ["--host", daemon] : ["--context", context];
  const user = process.platform === "win32" ? "1000:1000" : `${process.getuid()}:${process.getgid()}`;
  const cleanup = new Set();
  const supports = (name, model) => Boolean(key && model.provider === "anthropic" && models.has(model.model) &&
    (!model.reasoning || name === "omp"));

  function start(program, args, options, { signal, budgetCents = 0, model } = {}) {
    signal?.throwIfAborted();
    const cwd = fs.realpathSync(options.cwd);
    if (path.dirname(cwd) !== root || fs.lstatSync(options.cwd).isSymbolicLink() ||
        !/^[a-f0-9-]{36}$/i.test(path.basename(cwd)) || cwd.includes(",")) throw problem(409, "Invalid managed Docker worktree");
    const name = "omp-loop-" + randomUUID();
    const controller = new AbortController();
    const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const agent = program === "omp" || program === "claude";
    const flags = ["run", "--rm", "-i", "--pull=never", "--name", name, "--network", "none", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "2g", "--cpus", "2",
      "--stop-timeout", "2", "--pids-limit", "128", "--user", user, "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777,size=256m",
      "--mount", "type=bind,src=" + cwd + ",dst=/workspace,bind-propagation=rprivate,bind-recursive=disabled",
      "--workdir", "/workspace", "--env", "HOME=/tmp", "--env", "CI=1"];
    if (agent) flags.push("--env", "ANTHROPIC_BASE_URL=http://127.0.0.1:7351",
      "--env", "ANTHROPIC_API_KEY=omp-local-gateway", "--env", "PI_CODING_AGENT_DIR=/tmp/agent",
      "--env", "BUN_INSTALL_CACHE_DIR=/tmp/bun-cache", "--env", "DISABLE_NONESSENTIAL_TRAFFIC=1",
      "--env", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", "--env", "OMP_BRIDGE_MODEL=" + model.model);
    const command = agent ? ["--entrypoint", "node", image, bridgeFile, program, ...args] :
      ["--entrypoint", program, image, ...args];
    const raw = launchProcess(binary, [...prefix, ...flags, ...command], {
      cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    cleanup.add(abort);
    raw.stdin.on("error", () => {});
    function remove() {
      const process = launchProcess(binary, [...prefix, "rm", "-f", name], { env, windowsHide: true, stdio: "ignore" });
      process.on("error", () => {});
    }
    function abort() {
      if (controller.signal.aborted) return;
      controller.abort();
      raw.kill();
      remove();
    }
    lifetime.addEventListener("abort", abort, { once: true });
    raw.once("close", () => {
      cleanup.delete(abort);
      lifetime.removeEventListener("abort", abort);
      if (lifetime.aborted) remove();
      if (!controller.signal.aborted) controller.abort();
    });
    if (!agent) { raw.stdin.end(); raw.abortIsolation = abort; return raw; }
    return bridgeProcess(raw, createAnthropicBroker({ model: model.model, key, budgetCents, signal: lifetime, upstream }), abort);
  }

  const backend = {
    enforced: true,
    supports,
    ompPrompt: "/tmp/omp-system.md",
    launch: start,
    terminate: (child) => child.abortIsolation ? child.abortIsolation() : child.kill(),
    protocol: "docker-anthropic",
  };
  return {
    ...secureRunner(adaptersFor(backend), commandRunner(backend, permitted)),
    shutdown: () => { for (const terminate of cleanup) terminate(); },
  };
}

module.exports = { dockerRunner, bridgeProcess, permitted };
