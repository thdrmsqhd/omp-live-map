"use strict";

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const credentials = require("./credentials.cjs");

const token = randomBytes(32).toString("hex");
let child, origin, shutdown = false, window;
const userData = app.commandLine.getSwitchValue("user-data-dir");
if (userData && path.isAbsolute(userData)) app.setPath("userData", userData);
const root = app.isPackaged ? path.join(process.resourcesPath, "runtime") : path.resolve(__dirname, "..");
const endpoints = new Set([
  "projects", "projects/archive", "definitions", "definitions/remove", "definitions/version",
  "runs", "run", "runs/action", "capabilities", "events", "runtime", "runtime/key",
]);

function startServer() {
  const data = app.getPath("userData");
  child = spawn(process.execPath, [path.join(root, "server.js"), "--port", "0"], {
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1",
      OMP_MAP_ENGINEERING_TOKEN: token, OMP_MAP_ENGINEERING_DATA: data,
      ...(app.isPackaged ? { OMP_MAP_STATE: path.join(data, "legacy-state") } : {}) },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  return new Promise((resolve, reject) => {
    let errors = "";
    const timeout = setTimeout(() => reject(new Error("Live Map did not start within 15 seconds")), 15000);
    function ready(message) {
      const port = message?.port;
      if (message?.type !== "desktop-ready" || !Number.isInteger(port) || port < 1 || port > 65535) return;
      child.off("message", ready);
      clearTimeout(timeout);
      origin = `http://127.0.0.1:${port}`;
      resolve();
    }
    child.on("message", ready);
    child.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-8192); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timeout);
      reject(new Error(errors.includes("EADDRINUSE") ? "Could not bind a local port." : "Live Map server exited."));
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
  if (endpoint === "runtime/key") {
    try {
      if (payload?.remove) credentials.remove();
      else credentials.save(payload?.value);
      child.send({ type: "desktop-runtime-key", key: payload?.remove ? null : payload.value });
      return { ok: true, value: {} };
    } catch (error) { return { ok: false, error: error.message }; }
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
  const key = credentials.load();
  if (key) child.send({ type: "desktop-runtime-key", key });
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
