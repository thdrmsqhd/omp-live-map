"use strict";

const path = require("node:path");
const root = path.resolve(process.env.OMP_BENCH_REPO || path.join(__dirname, "../.."));
if (process.argv[2] === "--port" && process.send) {
  process.on("message", (message) => {
    if (message.type === "measure-heap") process.send({ type: "heap-sample", memory: process.memoryUsage(), cpu: process.cpuUsage() });
  });
  require(path.join(root, "server.js"));
} else {
  void measure().catch((error) => { console.error(error); process.exitCode = 1; });
}

async function measure() {
  const assert = require("node:assert/strict");
  const { fork } = require("node:child_process");
  const { on, once } = require("node:events");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const { performance } = require("node:perf_hooks");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-backend-bench-"));
  const fixtures = path.join(directory, ".omp", "agent", "sessions", "memory");
  let server;
  const timeout = AbortSignal.timeout(45_000);
  try {
    await fs.mkdir(fixtures, { recursive: true });
    const timestamp = new Date().toISOString();
    const record = (type, fields) => JSON.stringify({ type, timestamp, ...fields }) + "\n";
    const nodes = 32;
    const paths = Array.from({ length: nodes }, (_, i) => path.join(fixtures, `memory-${i}.jsonl`));
    await Promise.all(paths.map((file, i) => fs.writeFile(file,
      record("session", { id: `memory-${i}`, cwd: directory }) +
      Array.from({ length: 35 }, (_, n) => record("message", { message: {
        role: "assistant", stopReason: "stop", usage: { input: 30, output: 60 },
        content: [{ type: "text", text: `Session ${i}, response ${n}. ` + "한글 fixture response payload. ".repeat(60) }],
      } })).join(""))));
    server = fork(__filename, ["--port", "0"], {
      env: { ...process.env, HOME: directory, USERPROFILE: directory, OMP_MAP_STATE: path.join(directory, "state") },
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    const [chunk] = await once(server.stdout, "data", { signal: timeout });
    const port = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port, "backend did not report a loopback port");
    const url = `http://127.0.0.1:${port}`;
    const eventStream = await fetch(`${url}/api/events?graph=2`, { signal: timeout });
    assert.equal(eventStream.status, 200);
    const reader = eventStream.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    async function nextMatch(text) {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.includes(JSON.stringify(text))) return;
          continue;
        }
        const { value, done } = await reader.read();
        assert.equal(done, false);
        buffer += value;
      }
    }
    const samples = [];
    for (let i = 0; i < 12; i++) {
      const title = `Updated trace ${i}`;
      const start = performance.now();
      await fs.appendFile(paths[i % nodes], record("title", { title, timestamp: new Date().toISOString() }));
      await nextMatch(title);
      const watchToSseMs = performance.now() - start;
      const messages = on(server, "message", { signal: timeout });
      server.send({ type: "measure-heap" });
      for await (const [reply] of messages) {
        if (reply.type !== "heap-sample") continue;
        if (i >= 3) samples.push({ watchToSseMs, ...reply.memory, cpu: reply.cpu });
        break;
      }
    }
    await reader.cancel();
    const result = { ref: process.env.OMP_BENCH_REF || "workspace", nodes, node: process.version, platform: process.platform,
      warmup: 3, samples, memoryScope: "Node API server process only" };
    if (process.env.OMP_MEMORY_OUTPUT) await fs.writeFile(process.env.OMP_MEMORY_OUTPUT, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, "exit");
      server.kill();
      await closed;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
