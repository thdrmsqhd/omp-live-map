"use strict";

const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const chunks = new Map();
let seq = 0;
let agent, pendingInput = [], inputEnded = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const routes = new Set(["/v1/messages", "/v1/messages/count_tokens"]);

const server = http.createServer(async (req, res) => {
  const route = String(req.url ?? "").split("?")[0];
  if (req.method !== "POST" || !routes.has(route) || chunks.size >= 8) {
    res.writeHead(403).end();
    return;
  }
  const body = [];
  let received = 0;
  try {
    for await (const chunk of req) {
      received += chunk.length;
      if (received > 1024 * 1024) { res.writeHead(413).end(); return; }
      body.push(chunk);
    }
  } catch { return; }
  const id = ++seq;
  chunks.set(id, res);
  res.on("close", () => chunks.delete(id));
  send({ kind: "request", id, path: route, method: "POST", body: Buffer.concat(body).toString("utf8") });
});
server.listen(7351, "127.0.0.1", () => {
  const [program, ...args] = process.argv.slice(2);
  if (program === "omp") {
    const home = "/tmp/agent";
    fs.mkdirSync(home, { recursive: true });
    const model = process.env.OMP_BRIDGE_MODEL;
    if (!/^claude-[a-z0-9-]+$/.test(model)) process.exit(2);
    fs.writeFileSync("/tmp/omp-system.md", "Make changes only in the workspace. Verification runs separately. Avoid using shell tools.");
    args.push("--tools", "read,edit,write", "--no-extensions", "--no-skills", "--no-lsp", "--no-pty");
    fs.writeFileSync(home + "/models.yml", JSON.stringify({ providers: { "omp-bridge": {
      api: "anthropic-messages", baseUrl: "http://127.0.0.1:7351", apiKey: "ANTHROPIC_API_KEY",
      models: [{ id: model, name: model, contextWindow: 100000, maxTokens: 8192, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
  }

  agent = spawn(program, args, { cwd: "/workspace", stdio: ["pipe", "pipe", "pipe"], env: process.env });
  agent.stdin.on("error", () => {});
  for (const chunk of pendingInput) agent.stdin.write(chunk);
  pendingInput = [];
  if (inputEnded) agent.stdin.end();
  agent.stdout.on("data", (data) => send({ kind: "stdout", data: data.toString("base64") }));
  agent.stderr.on("data", (data) => send({ kind: "stderr", data: data.toString("base64") }));
  agent.once("error", () => { send({ kind: "exit", code: 127 }); process.exitCode = 127; server.closeAllConnections(); server.close(); });
  agent.once("close", (code) => {
    if (process.exitCode !== 127) send({ kind: "exit", code: Number.isInteger(code) ? code : 1 });
    process.exitCode ||= code || 0;
    server.closeAllConnections();
    server.close();
    process.stdin.destroy();
  });
  send({ kind: "ready" });
});

const parent = createInterface({ input: process.stdin });
parent.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const response = chunks.get(message.id);
  if (message.kind === "input") {
    const bytes = Buffer.from(message.data, "base64");
    if (agent) agent.stdin.write(bytes);
    else pendingInput.push(bytes);
  }
  if (message.kind === "input-end") {
    inputEnded = true;
    agent?.stdin.end();
  }
  if (!response) return;
  if (message.kind === "headers") response.writeHead(message.status, { "content-type": message.type });
  if (message.kind === "data") response.write(Buffer.from(message.data, "base64"));
  if (message.kind === "end") response.end();
});

parent.on("close", () => {
  if (agent && agent.exitCode === null && agent.signalCode === null) agent.kill();
});
