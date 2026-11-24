"use strict";

const path = require("node:path");
const { app, BrowserWindow, utilityProcess } = require("electron");

const port = Number(process.env.OMP_PROBE_PORT);
let server;
let window;

globalThis.probe = app.whenReady().then(async () => {
  server = utilityProcess.fork(path.resolve(__dirname, "../../server.js"), ["--port", String(port)], {
    env: process.env,
    stdio: "pipe",
  });
  const result = await new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => resolve({ error: "Server readiness timed out" }), 8000);
    function finish(value) {
      clearTimeout(timer);
      resolve(value);
    }
    server.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(`omp live map: http://127.0.0.1:${port}`)) finish({ ready: true });
    });
    server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    server.once("exit", (code) => finish({ code, error: stderr.trim() || "Server exited" }));
  });
  if (!result.ready) return result;

  window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(`http://127.0.0.1:${port}`);
  const { nodeIntegration, contextIsolation, sandbox } = window.webContents.getLastWebPreferences();
  return { ready: true, pid: server.pid, nodeIntegration, contextIsolation, sandbox };
}).catch((error) => ({ error: error.message }));

app.on("before-quit", (event) => {
  if (!server?.pid) return;
  event.preventDefault();
  const owned = server;
  server = undefined;
  owned.once("exit", () => app.quit());
  owned.kill();
});
