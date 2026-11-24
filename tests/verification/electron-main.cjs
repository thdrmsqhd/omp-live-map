"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const { OMP_PROBE_DIRECTORY: directory, OMP_PROBE_RESULT: resultFile } = process.env;
const port = Number(process.env.OMP_PROBE_PORT);
let server;
let window;

app.setPath("userData", directory);
const timeout = setTimeout(() => finish({ error: "Electron probe timed out" }), 20000);

function finish(result) {
  clearTimeout(timeout);
  fs.writeFileSync(resultFile, JSON.stringify(result));
  app.quit();
}

async function probe() {
  const args = [path.resolve(__dirname, "../../server.js"), "--port", String(port)];
  server = spawn(process.env.OMP_PROBE_NODE, args, {
    env: { ...process.env, USERPROFILE: directory, OMP_MAP_STATE: directory },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const result = await new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    server.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(`omp live map: http://127.0.0.1:${port}`)) resolve({ ready: true });
    });
    server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    server.once("error", (error) => resolve({ error: error.stack }));
    server.once("close", (code) => resolve({ code, error: stderr.trim() || "Server exited" }));
  });
  if (!result.ready) return result;

  window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(`http://127.0.0.1:${port}`);
  const stageVisible = await window.webContents.executeJavaScript("Boolean(document.querySelector('#stage'))");
  const graph = await fetch(`http://127.0.0.1:${port}/api/graph`, { signal: AbortSignal.timeout(3000) });
  const { nodeIntegration, contextIsolation, sandbox } = window.webContents.getLastWebPreferences();
  return {
    ready: true, pid: server.pid, stageVisible, graphReady: graph.ok && Array.isArray((await graph.json()).sessions),
    nodeIntegration, contextIsolation, sandbox,
  };
}

app.whenReady().then(probe).then(finish, (error) => finish({ error: error.stack }));
app.on("before-quit", (event) => {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  event.preventDefault();
  const owned = server;
  server = undefined;
  owned.once("exit", () => app.quit());
  owned.kill();
});
