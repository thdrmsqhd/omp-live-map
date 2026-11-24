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

const http = require("http");
const { SESSIONS, PORT } = require("./server/config");
const desktop = PORT === 0 && process.connected;
if (desktop) process.send({ type: "desktop-starting" });
const { handle } = require("./server/routes");

const server = http.createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

require("./server/desktop-shutdown").enableDesktopShutdown(server);

server.listen(PORT, "127.0.0.1", () => {
  const { port } = server.address();
  if (desktop) process.send({ type: "desktop-ready", port });
  console.log(`omp live map: http://127.0.0.1:${port}  (sessions: ${SESSIONS})`);
  setImmediate(() => require("./server/observation").startObservation());
});
