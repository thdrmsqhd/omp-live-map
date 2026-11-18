#!/usr/bin/env node
/**
 * omp-live-map: real-time OMP session/agent/subagent tracker + in-app terminal.
 *
 * Reads ~/.omp/agent/sessions/<folder>/<session>.jsonl and nested
 * <session>/<Agent>.jsonl subagent transcripts, incrementally (tail offsets).
 * Zero dependencies. Binds 127.0.0.1. Modules live in ./server/.
 *
 *   node server.js [--port 7800] [--hours 24]
 */
"use strict";

const fs = require("fs");
const http = require("http");
const { SESSIONS, PORT } = require("./server/config");
const { scan } = require("./server/tail");
const claude = require("./server/harness/claude");
const { refreshProc } = require("./server/proc");
const { broadcast } = require("./server/sse");
const { handle } = require("./server/routes");

const server = http.createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

scan();
claude.scan();
refreshProc();
require("./server/active").start();
require("./server/ext-live").start();
setInterval(() => { refreshProc(); }, 4000);
setInterval(() => {
  scan();
  claude.scan();
  broadcast();
}, 2000);

let watchDebounce = null;
try {
  fs.watch(SESSIONS, { recursive: true }, () => {
    if (watchDebounce) return;
    watchDebounce = setTimeout(() => {
      watchDebounce = null;
      scan();
      broadcast();
    }, 300);
  });
} catch {
  /* polling covers it */
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`omp live map: http://127.0.0.1:${PORT}  (sessions: ${SESSIONS})`);
});
