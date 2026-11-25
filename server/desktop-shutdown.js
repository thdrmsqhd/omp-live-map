"use strict";

// The desktop parent is the only sender on this private child-process channel.
function enableDesktopShutdown(server) {
  if (!process.connected) return;
  let stopping = false;
  process.on("message", (message) => {
    if (stopping || message?.type !== "desktop-shutdown") return;
    stopping = true;
    require("./sse").flushActivity();
    server.close();
    server.closeAllConnections();
    const sessions = require("./sessions");
    const { bgJobs } = require("./shell");
    const { killTree } = require("./rpc");
    for (const { node } of sessions.list()) sessions.stopSession(node);
    for (const job of bgJobs()) if (!job.done) killTree(job.proc);
    setTimeout(() => process.exit(0), 5500);
    const done = () => sessions.list().every(({ pid }) => !pid) && bgJobs().every((job) => job.done);
    const timer = setInterval(() => {
      if (done()) {
        clearInterval(timer);
        process.exit(0);
      }
    }, 50);
  });
}

module.exports = { enableDesktopShutdown };
