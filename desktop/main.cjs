"use strict";

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");

const port = 7800;
const origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString("hex");
let child, shutdown = false, window;
const userData = app.commandLine.getSwitchValue("user-data-dir");
if (userData && path.isAbsolute(userData)) app.setPath("userData", userData);
const root = app.isPackaged ? path.join(process.resourcesPath, "runtime") : path.resolve(__dirname, "..");
const endpoints = new Set([
  "projects", "projects/archive", "definitions", "definitions/remove",
  "runs", "run", "runs/action", "capabilities", "events",
]);

function startServer() {
  const data = app.getPath("userData");
  child = spawn(process.execPath, [path.join(root, "server.js"), "--port", String(port)], {
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1",
      OMP_MAP_ENGINEERING_TOKEN: token, OMP_MAP_ENGINEERING_DATA: data,
      ...(app.isPackaged ? { OMP_MAP_STATE: path.join(data, "legacy-state") } : {}) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  return new Promise((resolve, reject) => {
    let output = "", errors = "";
    const timeout = setTimeout(() => reject(new Error("Live Map did not start within 15 seconds")), 15000);
    child.stdout.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      if (!output.includes("omp live map: " + origin)) return;
      clearTimeout(timeout);
      resolve();
    });
    child.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-8192); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timeout);
      reject(new Error(errors.includes("EADDRINUSE") ? "Port 7800 is already in use." : "Live Map server exited."));
      if (window && !shutdown) app.quit();
    });
  });
}

ipcMain.handle("engineering:request", async (event, { endpoint, params, payload }) => {
  const frame = event.senderFrame;
  if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame ||
      frame.url !== origin + "/engineering.html" || !endpoints.has(endpoint)) {
    return { ok: false, error: "Request denied" };
  }
  const target = new URL("/api/engineering/" + endpoint, origin);
  target.search = new URLSearchParams(params ?? {}).toString();
  const headers = { "x-omp-engineering-token": token, "content-type": "application/json" };
  const response = await fetch(target, { method: payload === undefined ? "GET" : "POST", headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: "error", signal: AbortSignal.timeout(15000) });
  const value = await response.json();
  return response.ok ? { ok: true, value } : { ok: false, error: value.error };
});

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  await startServer();
  window = new BrowserWindow({
    width: 1450, height: 960,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: app.isPackaged ? ["--omp-local-monaco"] : [],
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (![origin + "/", origin + "/engineering.html"].includes(new URL(url).origin + new URL(url).pathname)) {
      event.preventDefault();
    }
  });
  await window.loadURL(origin);
}).catch((error) => {
  dialog.showErrorBox("OMP Live Map", error.message);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null || shutdown) return;
  event.preventDefault();
  shutdown = true;
  const owned = child;
  const deadline = setTimeout(() => {
    if (process.platform === "win32" && owned.pid) {
      const kill = spawn("taskkill", ["/pid", String(owned.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      kill.once("error", () => owned.kill());
    } else owned.kill();
  }, 7000);
  owned.once("close", () => { clearTimeout(deadline); app.quit(); });
  owned.send({ type: "desktop-shutdown" }, (error) => { if (error) owned.kill(); });
});
