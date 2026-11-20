// Java 언어 서버(Eclipse JDT LS) 관리: 프로젝트 루트별 프로세스 하나, 유휴 시 종료. 정의 이동만 지원한다.
// JDT LS 는 JDK 25 이상(최신 스냅샷 기준)이 필요하다. 위치: OMP_JDTLS(설치 폴더)·OMP_JDTLS_JAVA(JDK 폴더), 기본은 ~/.local/share/{jdtls,jdk21/*}.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL, fileURLToPath } = require("url");
const { LspClient } = require("./lsp-client");

const IDLE_MS = 10 * 60 * 1000;
const INIT_TIMEOUT = 120000;
const DEF_TIMEOUT = 60000;
const SHARE = path.join(os.homedir(), ".local", "share");
const MARKERS = ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", ".project", ".git"];

const servers = new Map(); // root -> {client, ready, docs, timer}

function findJdk() {
  if (process.env.OMP_JDTLS_JAVA) return process.env.OMP_JDTLS_JAVA;
  try {
    const d = fs.readdirSync(path.join(SHARE, "jdk21")).find((n) => fs.existsSync(path.join(SHARE, "jdk21", n, "bin", "java.exe")));
    return d ? path.join(SHARE, "jdk21", d) : null;
  } catch { return null; }
}

function install() {
  const home = process.env.OMP_JDTLS || path.join(SHARE, "jdtls");
  try {
    const jar = fs.readdirSync(path.join(home, "plugins")).find((n) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(n));
    const jdk = findJdk();
    const java = jdk && path.join(jdk, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (jar && java && fs.existsSync(java)) return { java, jar: path.join(home, "plugins", jar), home };
  } catch { /* 설치 안 됨 */ }
  return null;
}

const available = () => !!install();

function rootOf(file) {
  const start = path.dirname(file);
  let dir = start;
  for (let i = 0; i < 40; i++) {
    for (const m of MARKERS) if (fs.existsSync(path.join(dir, m))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

function stop(root) {
  const ws = servers.get(root);
  if (!ws) return;
  servers.delete(root);
  clearTimeout(ws.timer);
  ws.client.dispose();
}

function touch(ws, root) {
  clearTimeout(ws.timer);
  ws.timer = setTimeout(() => stop(root), IDLE_MS);
}

function start(root) {
  const inst = install();
  if (!inst) throw new Error("Java 언어 서버 없음(JDT LS + JDK 25)");
  const cfg = path.join(inst.home, process.platform === "win32" ? "config_win" : "config_linux");
  const data = path.join(SHARE, "jdtls-data", crypto.createHash("md5").update(root).digest("hex").slice(0, 12));
  const args = ["-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4",
    "-Declipse.product=org.eclipse.jdt.ls.core.product", "-Xmx1g", "-jar", inst.jar, "-configuration", cfg, "-data", data];
  const client = new LspClient(inst.java, args);
  const ws = { client, docs: new Map(), ready: null, timer: null };
  servers.set(root, ws);
  client.onExit = () => { if (servers.get(root) === ws) servers.delete(root); };
  const rootUri = pathToFileURL(root).href.replace(/\/$/, "");
  ws.ready = client.request("initialize", {
    processId: process.pid, rootUri,
    capabilities: { textDocument: { definition: { linkSupport: true } }, workspace: { workspaceFolders: true } },
    workspaceFolders: [{ uri: rootUri, name: path.basename(root) || root }],
  }, INIT_TIMEOUT).then(() => client.notify("initialized", {})).catch((e) => {
    stop(root);
    throw e;
  });
  ws.ready.catch(() => {});
  touch(ws, root);
  return ws;
}

async function definition(file, text, line, character) {
  const root = rootOf(file);
  let ws = servers.get(root);
  if (!ws || ws.client.exitCode !== null) ws = start(root);
  const uri = pathToFileURL(file).href;
  await ws.ready;
  const prev = ws.docs.get(uri);
  const version = (prev || 0) + 1;
  ws.docs.set(uri, version);
  if (prev === undefined) ws.client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "java", version, text } });
  else ws.client.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
  // 프로젝트 가져오기가 끝나기 전에는 빈 결과가 올 수 있어 몇 번 다시 묻는다.
  const end = Date.now() + DEF_TIMEOUT;
  let res = null;
  for (;;) {
    res = await ws.client.request("textDocument/definition", { textDocument: { uri }, position: { line, character } }, DEF_TIMEOUT);
    if ((Array.isArray(res) ? res.length : res) || Date.now() > end - 5000) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  touch(ws, root);
  const out = [];
  for (const it of Array.isArray(res) ? res : res ? [res] : []) {
    const range = it.targetSelectionRange || it.range;
    const u = it.targetUri || it.uri;
    if (!u || !range || !String(u).startsWith("file:")) continue;
    try { out.push({ path: fileURLToPath(u), line: range.start.line, character: range.start.character }); } catch { /* 버림 */ }
  }
  return out.slice(0, 20);
}

process.on("exit", () => {
  for (const ws of servers.values()) { try { ws.client.proc.kill(); } catch { /* ignore */ } }
});

module.exports = { available, definition };
