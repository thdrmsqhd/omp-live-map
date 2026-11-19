// Python 언어 서버(pyright-langserver) 관리: 워크스페이스 루트별 프로세스 하나, 유휴 시 종료.
// 표준 Content-Length JSON-RPC 로 initialize/didOpen/didChange/definition/publishDiagnostics 를 다룬다.
"use strict";

const path = require("path");
const { pathToFileURL, fileURLToPath } = require("url");
const { LspClient } = require("./lsp-client");
const { findPyright, rootOf } = require("./lsp-find");

const IDLE_MS = 5 * 60 * 1000;
const INIT_TIMEOUT = 30000;
const DEF_TIMEOUT = 20000;
const DIAG_TIMEOUT = 15000;

const servers = new Map(); // root -> {client, root, docs, diags, waiters, ready, timer}

function touch(ws) {
  clearTimeout(ws.timer);
  ws.timer = setTimeout(() => stop(ws.root), IDLE_MS);
}

function stop(root) {
  const ws = servers.get(root);
  if (!ws) return;
  servers.delete(root);
  clearTimeout(ws.timer);
  ws.client.dispose();
}

function start(root) {
  const bin = findPyright();
  if (!bin) throw new Error("Python 언어 서버 없음(pyright-langserver)");
  const client = new LspClient(bin, ["--stdio"]);
  const ws = { client, root, docs: new Map(), diags: new Map(), waiters: [], ready: null, timer: null };
  servers.set(root, ws);
  client.on("textDocument/publishDiagnostics", (p) => onDiag(ws, p));
  client.onExit = () => {
    if (servers.get(root) === ws) servers.delete(root);
  };
  const rootUri = pathToFileURL(root).href.replace(/\/$/, "");
  const init = client.request("initialize", {
    processId: process.pid,
    rootPath: root,
    rootUri,
    capabilities: {
      textDocument: {
        synchronization: { didSave: false, dynamicRegistration: false },
        definition: { linkSupport: true },
        publishDiagnostics: { relatedInformation: true },
      },
      workspace: { workspaceFolders: true, configuration: true },
    },
    workspaceFolders: [{ uri: rootUri, name: path.basename(root) || root }],
  }, INIT_TIMEOUT);
  ws.ready = init.then(() => {
    client.notify("initialized", {});
  }).catch((e) => {
    if (servers.get(root) === ws) servers.delete(root);
    client.dispose();
    throw e;
  });
  ws.ready.catch(() => {}); // 호출자가 다시 받는다
  touch(ws);
  return ws;
}

function ensure(root) {
  const ws = servers.get(root);
  if (ws && ws.client.exitCode === null) return ws;
  return start(root);
}

const fileUri = (file) => pathToFileURL(file).href;
// pyright 는 URI 를 정규화해 돌려준다(file:///c%3A/...). 같은 파일인지 비교하려면 키를 맞춘다.
const keyOf = (uri) => {
  let s = String(uri);
  try {
    s = decodeURIComponent(s);
  } catch { /* 그대로 둔다 */ }
  s = s.replace(/^file:\/\//i, "").replace(/\\/g, "/");
  return process.platform === "win32" ? s.toLowerCase() : s;
};

async function syncDoc(ws, uri, text) {
  await ws.ready;
  const prev = ws.docs.get(uri);
  if (prev === undefined) {
    ws.docs.set(uri, 1);
    ws.client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "python", version: 1, text } });
    return 1;
  }
  const version = prev + 1;
  ws.docs.set(uri, version);
  ws.client.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
  return version;
}

function mapDiag(d) {
  const r = d.range || {};
  const s = r.start || {};
  const e = r.end || s;
  return {
    line: s.line || 0,
    character: s.character || 0,
    endLine: e.line == null ? s.line || 0 : e.line,
    endCharacter: e.character == null ? s.character || 0 : e.character,
    severity: d.severity >= 1 && d.severity <= 4 ? d.severity : 1,
    message: String(d.message || ""),
  };
}

function onDiag(ws, p) {
  const uri = keyOf(p.uri);
  if (!p.uri) return;
  const items = (p.diagnostics || []).map(mapDiag);
  const version = typeof p.version === "number" ? p.version : Infinity;
  ws.diags.set(uri, { items, version });
  for (const w of ws.waiters.filter((x) => x.uri === uri && (version === Infinity || version >= x.version))) {
    clearTimeout(w.timer);
    w.resolve(items);
  }
  ws.waiters = ws.waiters.filter((w) => !(w.uri === uri && (version === Infinity || version >= w.version)));
}

function waitDiag(ws, uri, version) {
  const key = keyOf(uri);
  const seen = ws.diags.get(key);
  if (seen && seen.version >= version) return Promise.resolve(seen.items);
  return new Promise((resolve) => {
    const waiter = { uri: key, version, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      ws.waiters = ws.waiters.filter((w) => w !== waiter);
      const last = ws.diags.get(key);
      resolve(last ? last.items : []);
    }, DIAG_TIMEOUT);
    ws.waiters.push(waiter);
  });
}

function toLocations(res) {
  const items = Array.isArray(res) ? res : res ? [res] : [];
  const out = [];
  for (const it of items) {
    const range = it.targetSelectionRange || it.range;
    const uri = it.targetUri || it.uri;
    if (!uri || !range || !String(uri).startsWith("file:")) continue;
    try {
      out.push({ path: fileURLToPath(uri), line: range.start.line, character: range.start.character });
    } catch { /* 이상한 URI는 버린다 */ }
  }
  return out.slice(0, 20);
}

async function definition(file, text, line, character) {
  const ws = ensure(rootOf(file));
  const uri = fileUri(file);
  await syncDoc(ws, uri, text);
  const res = await ws.client.request("textDocument/definition", { textDocument: { uri }, position: { line, character } }, DEF_TIMEOUT);
  touch(ws);
  return toLocations(res);
}

async function diagnostics(file, text) {
  const ws = ensure(rootOf(file));
  const uri = fileUri(file);
  const version = await syncDoc(ws, uri, text);
  touch(ws);
  const items = await waitDiag(ws, uri, version);
  touch(ws);
  return items;
}

const available = () => !!findPyright();

process.on("exit", () => {
  for (const ws of servers.values()) {
    try {
      ws.client.proc.kill();
    } catch { /* ignore */ }
  }
});

module.exports = { available, definition, diagnostics, findPyright, rootOf };
