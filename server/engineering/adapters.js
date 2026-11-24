"use strict";

const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { createInterface } = require("node:readline");
const { open } = require("../rpc");
const { promptAssets } = require("./harness-assets");
const { problem, redact } = require("./state");

function prompt(context) {
  const { harness, instruction, feedback } = context;
  return [harness.role, harness.instructions, promptAssets(harness.assets), instruction,
    feedback.length ? "Previous verification results:\n" + JSON.stringify(feedback) : ""].filter(Boolean).join("\n\n");
}

function execution(backend, name, run) {
  return {
    enforced: backend.enforced === true,
    supports(model, harness) { return backend.supports(name, model, harness); },
    run(context) {
      if (backend.enforced !== true || !backend.supports(name, context.model, context.harness)) {
        throw problem(409, "Isolated adapter is unavailable");
      }
      context.signal.throwIfAborted();
      return run(backend, context);
    },
  };
}

async function omp(backend, context) {
  const { cwd, model, signal, budgetCents } = context;
  const rpc = open({
    cwd, launch: (program, args, options) => backend.launch(program, args, options, { budgetCents, signal, model }),
    terminate: (child) => backend.terminate(child),
    mainPrompt: backend.ompPrompt,
  });
  let diagnostics = "";
  if (backend.protocol) rpc.child.stderr.on("data", (data) => { diagnostics = (diagnostics + data).slice(-4000); });
  const closed = once(rpc.child, "close");
  closed.catch(() => {});
  const onAbort = () => backend.terminate(rpc.child);
  signal.addEventListener("abort", onAbort, { once: true });
  let costCents = 0;
  let turns = 0;
  const done = new Promise((resolve, reject) => {
    rpc.onEvent((frame) => {
      if (frame.type === "turn_end") {
        if (frame.message?.stopReason === "error" || frame.message?.stopReason === "aborted") {
          reject(new Error("OMP turn failed: " + redact(frame.message.errorMessage ?? frame.message.stopReason)));
          return;
        }
        const usd = frame.message?.usage?.cost?.total;
        if (!Number.isFinite(usd) || usd < 0) reject(new Error("OMP returned no valid cost"));
        else { costCents += usd * 100; turns++; }
      }
      if (frame.type === "extension_ui_request" && ["ask", "select", "confirm", "input", "editor"].includes(frame.method)) {
        reject(new Error("Interactive OMP request is unsupported in a Loop: " + frame.method));
      }
      if (frame.type === "agent_end") resolve();
    });
    closed.then(() => reject(new Error("OMP closed before the turn finished")), reject);
  });
  done.catch(() => {});
  const call = async (command) => {
    const response = await rpc.send(command);
    if (!response.success) throw new Error("OMP rejected " + command.type);
    return response.data ?? {};
  };
  try {
    const session = await call({ type: "get_state" });
    await call({ type: "set_model", provider: backend.protocol ? "omp-bridge" : model.provider, modelId: model.model });
    if (model.reasoning) await call({ type: "set_thinking_level", level: model.reasoning });
    await call({ type: "prompt", message: prompt(context) });
    await done;
    signal.throwIfAborted();
    if (!turns || !session.sessionId) throw new Error("OMP returned no completed turn or session");
    return { sessionId: session.sessionId, model: model.model, costCents: rpc.child.cost?.() ?? costCents, costBasis: backend.protocol ? "reserved" : "reported" };
  } catch (error) {
    if (diagnostics) throw new Error(error.message + ": " + redact(diagnostics));
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    rpc.close();
    await closed.catch(() => {});
  }
}

async function claude(backend, context) {
  const { cwd, model, signal, budgetCents } = context;
  if (model.reasoning) throw problem(409, "Reasoning level is unsupported by this Claude adapter");
  const sessionId = randomUUID();
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--permission-mode", "acceptEdits", "--session-id", sessionId, "--model", model.model];
  if (backend.protocol) args.push("--tools", "Read,Edit,Write,Glob,Grep", "--allowedTools", "Read,Edit,Write,Glob,Grep",
    "--setting-sources", "user", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}');
  const child = backend.launch("claude", args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }, { budgetCents, signal, model });
  const closed = once(child, "close");
  closed.catch(() => {});
  const terminate = () => backend.terminate(child);
  signal.addEventListener("abort", terminate, { once: true });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.stdin.end(prompt(context));
  const lines = createInterface({ input: child.stdout });
  let result;
  try {
    for await (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "result") result = event;
    }
    const [code] = await closed;
    signal.throwIfAborted();
    if (code !== 0 || !result || result.is_error || !Number.isFinite(result.total_cost_usd) || result.total_cost_usd < 0) {
      throw new Error("Claude returned no successful result with valid cost");
    }
    return { sessionId, model: model.model, costCents: child.cost?.() ?? result.total_cost_usd * 100, costBasis: backend.protocol ? "reserved" : "reported" };
  } finally {
    signal.removeEventListener("abort", terminate);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) terminate();
    await closed.catch(() => {});
  }
}

function adaptersFor(backend) {
  return new Map([["omp", execution(backend, "omp", omp)], ["claude", execution(backend, "claude", claude)]]);
}

module.exports = { adaptersFor };
