"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { setImmediate: yieldToServer } = require("node:timers/promises");
const { performance } = require("node:perf_hooks");
const { SESSIONS, CLAUDE_PROJECTS } = require("./config");
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

function sessionFile(root, name, harness) {
  const parts = String(name).split(path.sep);
  if (path.isAbsolute(String(name)) || parts.some((part) => !part || part === "." || part === "..")) return null;
  if (harness === "omp") {
    if (parts.length < 2 || parts.length > 6 || parts.slice(0, -1).some((part) => part === "local" || part.startsWith("."))) return null;
    return parts.at(-1).endsWith(".jsonl") ? path.join(root, ...parts) : null;
  }
  if (parts.length === 2 && parts[1].endsWith(".jsonl")) return path.join(root, ...parts);
  if (parts.length === 4 && parts[2] === "subagents" && /^agent-.*\.(jsonl|meta\.json)$/.test(parts[3])) {
    return path.join(root, parts[0], `${parts[1]}.jsonl`);
  }
  return null;
}

function createScanQueue(scan, onError) {
  let running;
  let full = false;
  const dirty = new Map();
  async function drain() {
    while (full || dirty.size) {
      const batch = { full, dirty: full ? [] : [...dirty] };
      full = false;
      dirty.clear();
      try { await scan(batch); } catch (error) { onError(error); }
    }
    running = undefined;
  }
  return (file, harness) => {
    if (!file || dirty.size >= 256) {
      full = true;
      dirty.clear();
    } else if (!full) dirty.set(file, harness);
    running ??= Promise.resolve().then(drain);
    return running;
  };
}

function startObservation() {
  let started = false;
  const schedule = createScanQueue(async ({ full, dirty }) => {
    if (full) {
      await scanCooperatively(tail.scanSteps());
      if (!started) {
        require("./active").start();
        started = true;
      }
      await scanCooperatively(claude.scanSteps());
    } else {
      function* scanDirty() {
        for (const [file, harness] of dirty) {
          if (harness === "omp") yield* tail.track(file);
          else claude.trackProject(file);
          yield;
        }
      }
      await scanCooperatively(scanDirty());
    }
    broadcast();
  }, (error) => console.error("Session observation:", error.code ?? error.name));
  void refreshProc();
  async function pollProc(){try{await refreshProc();}finally{setTimeout(pollProc,require("./performance").policy().pollMs).unref();}}
  setTimeout(pollProc,4000).unref();
  require("./ext-live").start();
  setInterval(() => schedule(), 2000);

  for (const [root, harness] of [[SESSIONS, "omp"], [CLAUDE_PROJECTS, "claude"]]) {
    let watcher;
    let timer;
    const dirty = new Set();
    let reconcile = false;
    try {
      const realRoot = fs.realpathSync(root);
      watcher = fs.watch(root, { recursive: true }, (event, name) => {
        if (event !== "change" || !name || dirty.size >= 256) {
          reconcile = true;
          dirty.clear();
        } else if (!reconcile) {
          const file = sessionFile(root, name, harness);
          if (!file) return;
          dirty.add(file);
        }
        timer ??= setTimeout(() => {
          timer = undefined;
          if (reconcile) schedule();
          else for (const file of dirty) {
            try {
              if (fs.realpathSync(file) === path.join(realRoot, path.relative(root, file))) schedule(file, harness);
            } catch { schedule(); }
          }
          dirty.clear();
          reconcile = false;
        }, 50);
      });
      watcher.on("error", () => { watcher.close(); schedule(); });
    } catch { /* polling covers unavailable roots */ }
  }
  schedule();
}

module.exports = { startObservation, createScanQueue, sessionFile };
