// 편집기 API: 파일 읽기/쓰기, Python 정의 이동·진단(LSP), 언어 서버 상태.
// 절대 경로·2MB 상한·바이너리 거부만 허용하고, 저장은 mtime 이 같을 때만 한다(다르면 409).
"use strict";

const fs = require("fs");
const path = require("path");
const { json, withJson } = require("./http");
const lsp = require("./lsp");

const MAX_FILE = 2 * 1024 * 1024;
const MAX_BODY = 3 * 1024 * 1024;

function absPath(p) {
  const s = String(p || "");
  if (!s || s.includes("\0") || !path.isAbsolute(s)) return null;
  return path.resolve(s);
}

function send(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": buf.length, "Cache-Control": "no-store" });
  res.end(buf);
}

const bad = (res, text) => send(res, 200, { ok: false, error: text });
const textOf = (p) => String(p.text == null ? "" : p.text);
const intOf = (v) => Math.max(0, Math.trunc(Number(v) || 0));

async function readText(file) {
  const st = await fs.promises.stat(file);
  if (!st.isFile()) throw new Error("폴더는 열 수 없습니다");
  if (st.size > MAX_FILE) throw new Error("파일이 너무 큽니다(2MB)");
  const buf = await fs.promises.readFile(file);
  if (buf.slice(0, 8192).includes(0)) throw new Error("바이너리 파일은 열 수 없습니다");
  return { text: buf.toString("utf8"), mtime: st.mtimeMs };
}

module.exports = {
  "* /api/editor/status": (req, res) => json(res, { ok: true, pyright: lsp.available() }),

  "POST /api/editor/read": (req, res) => withJson(req, res, async (p) => {
    const file = absPath(p.path);
    if (!file) return bad(res, "절대 경로가 아닙니다");
    try {
      const { text, mtime } = await readText(file);
      json(res, { ok: true, path: file, text, mtime });
    } catch (e) {
      bad(res, e.code === "ENOENT" ? "파일이 없습니다" : e.message || "읽기 실패");
    }
  }),

  "POST /api/editor/write": (req, res) => withJson(req, res, async (p) => {
    const file = absPath(p.path);
    if (!file) return bad(res, "절대 경로가 아닙니다");
    const text = textOf(p);
    if (Buffer.byteLength(text, "utf8") > MAX_FILE) return bad(res, "파일이 너무 큽니다(2MB)");
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile()) return bad(res, "파일이 아닙니다");
      const base = Number(p.mtime);
      if (p.mtime != null && Number.isFinite(base) && Math.abs(st.mtimeMs - base) > 1) {
        return send(res, 409, { ok: false, error: "파일이 다른 곳에서 바뀌었습니다", mtime: st.mtimeMs });
      }
      await fs.promises.writeFile(file, text, "utf8");
      json(res, { ok: true, mtime: (await fs.promises.stat(file)).mtimeMs });
    } catch (e) {
      bad(res, e.code === "ENOENT" ? "파일이 없습니다" : e.message || "저장 실패");
    }
  }, MAX_BODY),

  "POST /api/editor/definition": (req, res) => withJson(req, res, async (p) => {
    const file = absPath(p.path);
    if (!file) return bad(res, "절대 경로가 아닙니다");
    try {
      const locations = await lsp.definition(file, textOf(p), intOf(p.line), intOf(p.character));
      json(res, { ok: true, locations });
    } catch (e) {
      bad(res, e.message || "정의를 찾지 못했습니다");
    }
  }, MAX_BODY),

  "POST /api/editor/diagnostics": (req, res) => withJson(req, res, async (p) => {
    const file = absPath(p.path);
    if (!file) return bad(res, "절대 경로가 아닙니다");
    try {
      const items = await lsp.diagnostics(file, textOf(p));
      json(res, { ok: true, items });
    } catch (e) {
      bad(res, e.message || "진단을 받지 못했습니다");
    }
  }, MAX_BODY),
};
