"use strict";

const fs = require("node:fs");
const { setImmediate: yieldToServer } = require("node:timers/promises");
const { performance } = require("node:perf_hooks");
const { SESSIONS } = require("./config");
const tail = require("./tail");
const claude = require("./harness/claude");
const { refreshProc } = require("./proc");
const { broadcast } = require("./sse");

async function scanCooperatively(steps) {
  let deadline = performance.now() + 12;
  for (const step of steps) {
    if (performance.now() < deadline) continue;
    await yieldToServer();
    deadline = performance.now() + 12;
  }
}

function startObservation() {
  let scanning = false;
  let started = false;
  async function scan(includeClaude) {
    if (scanning) return;
    scanning = true;
    try {
      await scanCooperatively(tail.scanSteps());
      if (!started) {
        require("./active").start();
        started = true;
      }
      if (includeClaude) await scanCooperatively(claude.scanSteps());
      broadcast();
    } finally {
      scanning = false;
    }
  }
  const schedule = (includeClaude) => {
    scan(includeClaude).catch((error) => console.error("Session observation:", error.code ?? error.name));
  };
  void refreshProc();
  setInterval(refreshProc, 4000);
  require("./ext-live").start();
  setInterval(() => schedule(true), 2000);

  let watchDebounce;
  try {
    fs.watch(SESSIONS, { recursive: true }, () => {
      if (watchDebounce) return;
      watchDebounce = setTimeout(() => { watchDebounce = null; schedule(false); }, 300);
    }).on("error", () => { /* polling covers it */ });
  } catch { /* polling covers it */ }
  schedule(true);
}

module.exports = { startObservation };
