"use strict";

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const icon = path.join(__dirname, "icons", "omp-live-map.png");

let child, origin, shutdown = false, window;
let stage = "starting the app";
const userData = app.commandLine.getSwitchValue("user-data-dir");
if (userData && path.isAbsolute(userData)) app.setPath("userData", userData);
const root = app.isPackaged ? path.join(process.resourcesPath, "runtime") : path.resolve(__dirname, "..");

function startServer() {
  const data = app.getPath("userData");
  stage = "launching the local server";
  child = spawn(process.execPath, [path.join(root, "server.js"), "--port", "0"], {
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1",
      OMP_MAP_ENGINEERING_DATA: data,
      ...(app.isPackaged ? { OMP_MAP_STATE: path.join(data, "legacy-state") } : {}) },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  return new Promise((resolve, reject) => {
    let errors = "";
    const timeout = setTimeout(() => reject(new Error("로컬 서버가 시작 응답을 보내지 않았습니다.")), 30000);
    function ready(message) {
      if (message?.type === "desktop-starting") stage = "loading the local server";
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
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      const error = new Error(errors.includes("EADDRINUSE") ? "로컬 포트를 열 수 없습니다." : "로컬 서버가 시작 중 종료되었습니다.");
      error.code = errors.match(/code:\s*['"]([A-Z0-9_]+)['"]/)?.[1] ?? signal ?? code;
      reject(error);
      if (window && !shutdown) app.quit();
    });
  });
}

// 앱 창의 메인 프레임이 이 앱의 로컬 서버 주소일 때만 IPC 를 받는다. 돌려주는 값은 그 페이지 경로다.
function trustedPage(event) {
  const frame = event.senderFrame;
  const location = frame?.url ? new URL(frame.url) : null;
  if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame || location?.origin !== origin) return null;
  return location.pathname;
}

// 데스크톱 앱만 더하는 기능: 네이티브 폴더 대화상자. 고른 경로는 화면이 웹과 같은 HTTP API(projects/ensure)로 등록하고 서버가 검사한다.
// Engineering 데이터 읽기·쓰기는 IPC 없이 웹과 똑같이 같은 출처 HTTP 로 한다(서버 토큰은 index.html 에 심겨 온다).
ipcMain.handle("dialog:pick-folder", async (event) => {
  if (trustedPage(event) === null) return { ok: false, error: "Request denied" };
  // 개발 실행(패키지 전)의 검증 스크립트만 대화상자 대신 경로를 넘길 수 있다.
  const scripted = !app.isPackaged && process.env.OMP_MAP_TEST_PICK_FOLDER;
  const result = scripted ? { canceled: false, filePaths: [scripted] }
    : await dialog.showOpenDialog(window, { title: "작업 폴더 선택", properties: ["openDirectory"] });
  const picked = result.canceled ? null : result.filePaths[0] ?? null;
  return picked ? { ok: true, value: picked } : { ok: false, error: "선택을 취소했습니다." };
});

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  app.dock?.setIcon(icon);
  const importPath = app.commandLine.getSwitchValue("import-v2-data-dir");
  if (path.isAbsolute(importPath) || (app.isPackaged && !userData && !app.commandLine.hasSwitch("skip-v2-import"))) {
    stage = "copying V2 data";
    const source = importPath || path.join(app.getPath("appData"), "OMP Live Map V2");
    require(path.join(root, "server", "engineering", "v2-migration.js")).migrateFromV2(source, app.getPath("userData"));
  }
  await startServer();
  stage = "opening the app window";
  window = new BrowserWindow({
    width: 1450, height: 960,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: app.isPackaged ? ["--omp-local-monaco"] : [],
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin + new URL(url).pathname !== origin + "/") {
      event.preventDefault();
    }
  });
  await window.loadURL(origin);
  const perfTimer=setInterval(()=>{if(child?.connected&&!shutdown){const metrics=app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,cpu:m.cpu?.percentCPUUsage,memory:m.memory}));child.send({type:"desktop-performance",metrics},()=>{});}},5000);perfTimer.unref();window.once("closed",()=>clearInterval(perfTimer));
}).catch((error) => {
  const log = path.join(app.getPath("userData"), "startup-error.log");
  let details = `\n\n단계: ${stage}`;
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, JSON.stringify({ at: new Date().toISOString(), stage, code: error.code ?? null,
      version: app.getVersion() }) + "\n");
    details += `\n진단 파일: ${log}`;
  } catch { /* show the original startup error */ }
  dialog.showErrorBox("OMP Live Map", error.message + details);
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
