// LSP JSON-RPC 클라이언트: Content-Length 프레이밍으로 자식 프로세스 stdio 위에서 요청·알림을 주고받는다.
"use strict";

const { spawn } = require("child_process");

const MAX_MSG = 32 * 1024 * 1024;

class LspClient {
  constructor(cmd, args, opts = {}) {
    this.proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, ...opts });
    this.buf = Buffer.alloc(0);
    this.seq = 1;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.handlers = new Map(); // method -> fn(params)
    this.exitCode = null;
    this.onExit = null;
    this.proc.stdout.on("data", (d) => this.feed(d));
    this.proc.stderr.on("data", () => {}); // 언어 서버 로그는 버린다
    this.proc.on("exit", (code) => this.finish(code == null ? -1 : code));
    this.proc.on("error", () => this.finish(-1));
  }

  finish(code) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("language server exited"));
    }
    this.pending.clear();
    if (typeof this.onExit === "function") this.onExit(code);
  }

  send(msg) {
    if (this.exitCode !== null) return;
    const body = JSON.stringify({ jsonrpc: "2.0", ...msg });
    try {
      this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    } catch { /* 프로세스가 닫히는 중 */ }
  }

  request(method, params, timeout = 15000) {
    if (this.exitCode !== null) return Promise.reject(new Error("language server exited"));
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  on(method, fn) {
    this.handlers.set(method, fn);
  }

  // 들어온 바이트를 헤더+본문 단위로 잘라 JSON 메시지로 만든다.
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const end = this.buf.indexOf("\r\n\r\n");
      if (end < 0) break;
      const head = this.buf.slice(0, end).toString("ascii");
      const m = /content-length:\s*(\d+)/i.exec(head);
      if (!m) {
        this.buf = this.buf.slice(end + 4);
        continue;
      }
      const len = Number(m[1]);
      if (len < 0 || len > MAX_MSG) return this.proc.kill();
      if (this.buf.length < end + 4 + len) break;
      const body = this.buf.slice(end + 4, end + 4 + len).toString("utf8");
      this.buf = this.buf.slice(end + 4 + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  dispatch(msg) {
    const isReq = msg.id !== undefined && msg.id !== null;
    if (isReq && msg.method) {
      // 서버 -> 클라이언트 요청(설정 조회·기능 등록 등)은 최소 응답으로 넘긴다.
      const result = msg.method === "workspace/configuration" ? [] : null;
      return this.send({ id: msg.id, result });
    }
    if (isReq) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) return p.reject(new Error(msg.error.message || "lsp error"));
      return p.resolve(msg.result);
    }
    if (!msg.method) return;
    const fn = this.handlers.get(msg.method);
    if (fn) fn(msg.params || {});
  }

  dispose() {
    this.finish(-1);
    try {
      this.proc.stdin.end();
    } catch { /* ignore */ }
    try {
      this.proc.kill();
    } catch { /* ignore */ }
  }
}

module.exports = { LspClient };
