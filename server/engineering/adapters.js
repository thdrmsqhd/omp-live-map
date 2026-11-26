"use strict";

const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { createInterface } = require("node:readline");
const { open } = require("../rpc");
const { ask: registerWorkflowAsk, drop: dropWorkflowAsk, asksFor } = require("../ui-requests");
const { resultInstruction } = require("./harness-result");
const { promptAssets } = require("./harness-assets");
const { problem, redact } = require("./state");
const { acceptsWorkflowAsk, rejectsWorkflowAsk } = require("../application/workflow-gates");
const { claudeStreamProgress, ompToolLine } = require("./stream-progress");
const { brokerFailure } = require("./anthropic");

// 브로커가 호출을 막았으면(구독 로그인 만료·예산 소진) CLI 의 일반 오류 대신 그 사유로 실패한다.
function throwBrokerFailure(child) {
  const code = child?.failure?.();
  if (code) throw brokerFailure(code);
}

const claudeTools = ["Read", "Edit", "Write", "Glob", "Grep"];
// 암호·결제 정보·OS 승인 문구는 질문 카드에 담지 않는다. 일치 문구는 오류문에도 남기지 않는다.
const blockedAsk = /(?:\b(?:password|passwd|passphrase|cvv|cvc|uac|sudo)\b|credit\s*card|card\s*number|payment\s*(?:data|info|details|card)|os\s+approval|administrator\s+approval|admin(?:istrator)?\s+privileges?|비밀번호|패스워드|카드\s*번호|결제\s*정보|관리자\s*권한|사용자\s*계정\s*컨트롤)/i;

function blockedInteractive(frame) {
  if (!frame || frame.secret === true) return true;
  const parts = [];
  const push = (value) => { if (typeof value === "string" && value) parts.push(value); };
  push(frame.title);
  push(frame.message);
  push(frame.placeholder);
  push(frame.prefill);
  if (Array.isArray(frame.options)) for (const option of frame.options) push(typeof option === "string" ? option : option && option.label);
  if (Array.isArray(frame.questions)) for (const question of frame.questions) {
    if (!question || typeof question !== "object") continue;
    push(question.question);
    push(question.header);
    if (!Array.isArray(question.options)) continue;
    for (const option of question.options) {
      if (!option || typeof option !== "object") continue;
      push(option.label);
      push(option.description);
      push(option.preview);
    }
  }
  return blockedAsk.test(parts.join("\n"));
}

function askQuestion(question) {
  return {
    id: String(question.id ?? ""),
    question: String(question.question ?? ""),
    header: question.header ? String(question.header) : "",
    multi: !!question.multi,
    recommended: Number.isInteger(question.recommended) ? question.recommended : -1,
    options: (Array.isArray(question.options) ? question.options : []).map((option) => ({
      label: String((option && option.label) ?? ""),
      description: option && option.description ? String(option.description) : "",
      preview: option && option.preview ? String(option.preview) : "",
    })),
  };
}

// 화면 카드가 이미 그리는 필드만 남긴다. input·editor 는 여기까지 오지 않는다.
function workflowAskRequest(frame) {
  const request = { id: String(frame.id ?? ""), method: frame.method, timeout: Number(frame.timeout) || 0 };
  const timeout = request.timeout;
  if (timeout > 0) request.deadline = Date.now() + timeout;
  if (frame.method === "ask") {
    request.questions = (Array.isArray(frame.questions) ? frame.questions : []).map(askQuestion);
    return request;
  }
  if (frame.method === "select") {
    return {
      ...request,
      title: String(frame.title ?? ""),
      options: (Array.isArray(frame.options) ? frame.options : []).map(String),
      optionDetails: (Array.isArray(frame.optionDetails) ? frame.optionDetails : []).map((detail) => ({
        description: detail && detail.description ? String(detail.description) : "",
      })),
      initialIndex: Number.isInteger(frame.initialIndex) ? frame.initialIndex : 0,
      selectionMarker: frame.selectionMarker === "checkbox" ? "checkbox" : "radio",
      checkedIndices: (Array.isArray(frame.checkedIndices) ? frame.checkedIndices : []).filter(Number.isInteger),
      markableCount: Number.isInteger(frame.markableCount) ? frame.markableCount : 0,
    };
  }
  return { ...request, title: String(frame.title ?? ""), message: String(frame.message ?? "") };
}

function workflowAskResponse(method, response) {
  const source = response && typeof response === "object" ? response : {};
  if (source.cancelled) return { cancelled: true };
  if (source.timedOut) return { timedOut: true };
  if (method === "ask") {
    return {
      answers: (Array.isArray(source.answers) ? source.answers : []).map((answer) => {
        const out = {
          id: String((answer && answer.id) ?? ""),
          selectedOptions: (Array.isArray(answer && answer.selectedOptions) ? answer.selectedOptions : []).map(String),
        };
        const custom = answer && typeof answer.customInput === "string" ? answer.customInput : "";
        if (custom) out.customInput = custom;
        return out;
      }),
    };
  }
  if (method === "confirm") return { confirmed: !!(response && response.confirmed) };
  return { value: String((response && response.value) ?? "") };
}

function promptSections(harness, instruction = "", feedback = []) {
  return [
    { name: "role", text: harness.role },
    { name: "instructions", text: harness.instructions },
    { name: "assets", text: promptAssets(harness.assets) },
    ...(harness.resolvedSources ?? []).map(({ path, input, text }) => ({
      name: "source", path, text: (input ? "Workflow input " + input + " (" + path + ")" : "Repository file " + path) + ":\n" + text,
    })),
    { name: "result", text: resultInstruction(harness.result) },
    { name: "task", text: instruction },
    { name: "feedback", text: feedback.length ? "Previous verification results:\n" + JSON.stringify(feedback) : "" },
  ].filter(({ text }) => text);
}

function prompt({ harness, instruction, feedback }) {
  return promptSections(harness, instruction, feedback).map(({ text }) => text).join("\n\n");
}

// 실행 중 진행 상황(글자 조각·도구 호출)을 관제 화면에 넘긴다. 콜백이 없거나 실패해도 실행에는 영향이 없다.
function progressOf(context) {
  const report = typeof context.onProgress === "function" ? context.onProgress : null;
  return (patch) => {
    if (!report) return;
    try { report(patch); } catch { /* 진행 표시만 잃는다 */ }
  };
}

function execution(backend, name, run) {
  return {
    enforced: backend.enforced === true,
    executionPolicy: backend.protocol === "docker-anthropic" ? Object.freeze({
      directory: "/workspace",
      workspace: "managed-worktree",
      permission: "workspace-only",
      workspaceWritable: true,
      network: "isolated",
      tools: Object.freeze(name === "claude" ? claudeTools : ["read", "edit", "write"]),
    }) : null,
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
  const { cwd, model, signal, budgetCents, capture } = context;
  const rpc = open({
    cwd, launch: (program, args, options) => backend.launch(program, args, options, { budgetCents, signal, model, workflowAsk: context.workflowAsk === true }),
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
  let output = "";
  const tools = new Set();
  const progress = progressOf(context);
  // 한 턴의 질문 카드는 같은 키를 쓴다. 진행 이벤트는 첫 질문 대기 직전에 한 번만 낸다.
  let askSession = null;
  const done = new Promise((resolve, reject) => {
    rpc.onEvent((frame) => {
      if (frame.type === "message_update" && frame.assistantMessageEvent?.type === "text_delta" &&
          typeof frame.assistantMessageEvent.delta === "string") progress({ phase: "responding", text: frame.assistantMessageEvent.delta });
      if (frame.type === "tool_execution_start" && typeof frame.toolName === "string") progress({ phase: "tool", tool: frame.toolName, text: ompToolLine(frame) });
      if (capture && frame.type === "tool_execution_start" && typeof frame.toolName === "string" && tools.size < 40) {
        tools.add(frame.toolName.slice(0, 120));
      }
      if (frame.type === "turn_end") {
        if (capture && Array.isArray(frame.message?.content)) {
          const text = frame.message.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n");
          if (text) output = redact(text);
        }
        if (frame.message?.stopReason === "error" || frame.message?.stopReason === "aborted") {
          reject(new Error("OMP turn failed: " + redact(frame.message.errorMessage ?? frame.message.stopReason)));
          return;
        }
        const usd = frame.message?.usage?.cost?.total;
        if (!Number.isFinite(usd) || usd < 0) reject(new Error("OMP returned no valid cost"));
        else { costCents += usd * 100; turns++; }
      }
      if (frame.type === "extension_ui_request") {
        const method = frame.method;
        if (method === "cancel" && context.workflowAsk === true) {
          const target = String(frame.targetId ?? "");
          if (askSession && asksFor(askSession).some((item) => item.id === target)) dropWorkflowAsk(askSession);
          return;
        }
        if (acceptsWorkflowAsk(method) || rejectsWorkflowAsk(method)) {
          const id = String(frame.id ?? "");
          // 질문은 턴 실패가 아니다. input·editor·암호·결제·OS 승인은 여전히 거절한다.
          if (context.workflowAsk !== true || !acceptsWorkflowAsk(method) || !id || blockedInteractive(frame)) {
            reject(new Error("Interactive OMP request is unsupported in a Loop: " + method));
            return;
          }
          if (!askSession) {
            askSession = "workflow-ask:" + randomUUID();
            progress({ askSession });
          }
          if (asksFor(askSession).some((item) => item.id === id)) return;
          const request = workflowAskRequest(frame);
          registerWorkflowAsk(askSession, request, (response) => {
            const sent = rpc.sendRaw({ type: "extension_ui_response", id: request.id, ...workflowAskResponse(method, response) });
            return sent ? { ok: true } : { ok: false, out: "omp 프로세스에 답을 보내지 못했습니다" };
          });
          return;
        }
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
    // 핀된 omp 는 set_ask_dialog 이후에만 method ask 를 낸다. 실패해도 select·confirm 대기는 유지한다.
    if (context.workflowAsk === true) {
      const dialog = await rpc.send({ type: "set_ask_dialog", enabled: true });
      if (!dialog.success) { /* 이 빌드는 select·confirm 으로만 묻는다 */ }
    }
    await call({ type: "prompt", message: prompt(context) });
    await done;
    signal.throwIfAborted();
    if (!turns || !session.sessionId) throw new Error("OMP returned no completed turn or session");
    return { ...(capture ? { output: output || null, tools: [...tools] } : {}), sessionId: session.sessionId, model: model.model, costCents: rpc.child.cost?.() ?? costCents, costBasis: backend.protocol ? "reserved" : "reported" };
  } catch (error) {
    if (!signal.aborted) throwBrokerFailure(rpc.child);
    if (diagnostics) throw new Error(error.message + ": " + redact(diagnostics));
    throw error;
  } finally {
    if (askSession) dropWorkflowAsk(askSession);
    signal.removeEventListener("abort", onAbort);
    rpc.close();
    await closed.catch(() => {});
  }
}

async function claude(backend, context) {
  const { cwd, model, signal, budgetCents, capture } = context;
  if (model.reasoning) throw problem(409, "Reasoning level is unsupported by this Claude adapter");
  const sessionId = randomUUID();
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--permission-mode", "acceptEdits", "--session-id", sessionId, "--model", model.model];
  if (backend.protocol) args.push("--tools", claudeTools.join(","), "--allowedTools", claudeTools.join(","),
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
  const tools = new Set();
  const streamed = claudeStreamProgress(progressOf(context));
  try {
    for await (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "result") result = event;
      try { streamed(event); } catch { /* 진행 표시는 실행에 영향을 주지 않는다 */ }
      if (capture && event.type === "assistant") for (const block of (Array.isArray(event.message?.content) ? event.message.content : [])) {
        if (block.type === "tool_use" && typeof block.name === "string" && tools.size < 40) tools.add(block.name.slice(0, 120));
      }
    }
    const [code] = await closed;
    signal.throwIfAborted();
    if (code !== 0 || !result || result.is_error || !Number.isFinite(result.total_cost_usd)) throwBrokerFailure(child);
    // Claude Code 가 오류 결과를 냈으면(예: 모델에 비해 CLI 버전이 낮음) 그 이유를 그대로 남겨 관제 화면에서 보이게 한다.
    if (result?.is_error && typeof result.result === "string" && result.result) {
      throw new Error("Claude Code 실행 실패: " + redact(result.result).slice(0, 600));
    }
    if (code !== 0 || !result || result.is_error || !Number.isFinite(result.total_cost_usd) || result.total_cost_usd < 0) {
      throw new Error("Claude returned no successful result with valid cost");
    }
    return { ...(capture ? { output: typeof result.result === "string" ? redact(result.result) : null, tools: [...tools] } : {}), sessionId, model: model.model, costCents: child.cost?.() ?? result.total_cost_usd * 100, costBasis: backend.protocol ? "reserved" : "reported" };
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

module.exports = { adaptersFor, promptSections };
