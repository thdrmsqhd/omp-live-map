// 기록 꼬리 읽기: 파일 상태 Map 소유, 증분 읽기, 세션 폴더 스캔.
"use strict";

const fs = require("fs");
const path = require("path");
const { SESSIONS } = require("./config");
const { newFileState, parentOf, ingest } = require("./ingest");

const files = new Map(); // abs path -> file state

function readNew(st, bytes) {
  let text = st.pending;
  st.offset += bytes;
  st.pending = "";
  const buf = Buffer.allocUnsafe(bytes);
  const fd = fs.openSync(st.file, "r");
  try {
    fs.readSync(fd, buf, 0, bytes, st.offset - bytes);
  } finally {
    fs.closeSync(fd);
  }
  text += buf.toString("utf8");
  const lines = text.split("\n");
  st.pending = lines.pop() || "";
  for (const line of lines) {
    const t = line.trim();
    if (t) ingest(st, t);
  }
}

function track(file) {
  let st = files.get(file);
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (st && size === st.offset) return;
  if (!st) {
    st = newFileState(file);
    st.parent = parentOf(file, st.depth);
    files.set(file, st);
  }
  if (size < st.offset) st.offset = 0; // truncated/rewritten
  if (size > st.offset) {
    try {
      readNew(st, size - st.offset);
    } catch {
      /* file rotated mid-read */
    }
    st.mtime = size;
  }
}

function scan() {
  const roots = fs.existsSync(SESSIONS) ? fs.readdirSync(SESSIONS, { withFileTypes: true }) : [];
  const seen = new Set();
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "local" || ent.name.startsWith(".")) continue;
        if (path.relative(SESSIONS, dir).split(path.sep).length >= 5) continue;
        walk(full, depth + 1);
      } else if (ent.name.endsWith(".jsonl")) {
        seen.add(full);
        track(full);
      }
    }
  };
  for (const r of roots) {
    if (!r.isDirectory()) continue;
    if (r.name === "local" || r.name.startsWith(".")) continue;
    for (const ent of fs.readdirSync(path.join(SESSIONS, r.name), { withFileTypes: true })) {
      const full = path.join(SESSIONS, r.name, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "local" || ent.name.startsWith(".")) continue;
        walk(full, 3);
      } else if (ent.name.endsWith(".jsonl")) {
        seen.add(full);
        track(full);
      }
    }
  }
  return seen;
}

function stateOf(file) {
  return files.get(file) || null;
}

function allStates() {
  return files.values();
}

module.exports = { scan, stateOf, allStates };
