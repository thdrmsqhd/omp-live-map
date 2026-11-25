// 기록 꼬리 읽기: 파일 상태 Map 소유, 증분 읽기, 세션 폴더 스캔.
"use strict";

const fs = require("fs");
const path = require("path");
const { StringDecoder } = require("node:string_decoder");
const { SESSIONS, HOURS } = require("./config");
const { newFileState, parentOf, ingest } = require("./ingest");

const files = new Map(); // abs path -> file state
const READ_BYTES = 512 * 1024;

function readNew(st, bytes) {
  const buf = Buffer.allocUnsafe(bytes);
  const fd = fs.openSync(st.file, "r");
  let read;
  try {
    read = fs.readSync(fd, buf, 0, bytes, st.offset);
  } finally {
    fs.closeSync(fd);
  }
  if (!read) return false;
  st.offset += read;
  const text = st.pending + st.decoder.write(buf.subarray(0, read));
  const lines = text.split("\n");
  st.pending = lines.pop() || "";
  for (const line of lines) {
    const t = line.trim();
    if (t) ingest(st, t);
  }
  return true;
}

function* track(file) {
  let st = files.get(file);
  let size;
  try {
    const stat=fs.statSync(file);if(stat.mtimeMs<Date.now()-Math.max(HOURS,24)*3600000){files.delete(file);return;}size=stat.size;
  } catch {
    return;
  }
  if (st && size === st.offset) return;
  if (!st) {
    st = newFileState(file);
    st.parent = parentOf(file, st.depth);
    st.decoder = new StringDecoder("utf8");
    files.set(file, st);
  }
  if (size < st.offset) {
    st.offset = 0;
    st.pending = "";
    st.decoder = new StringDecoder("utf8");
  }
  while (size > st.offset) {
    try {
      if (!readNew(st, Math.min(READ_BYTES, size - st.offset))) break;
    } catch { break; }
    st.mtime = st.offset;
    yield;
  }
}

function* scanSteps(seen = new Set()) {
  function* walk(dir, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    yield;
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "local" || ent.name.startsWith(".")) continue;
        if (depth < 5) yield* walk(full, depth + 1);
      } else if (depth > 0 && ent.name.endsWith(".jsonl")) {
        seen.add(full);
        yield* track(full);
        yield;
      }
    }
  }
  yield* walk(SESSIONS, 0);
  for(const key of files.keys())if(!seen.has(key)&&!fs.existsSync(key))files.delete(key);
}

function scan() {
  const seen = new Set();
  for (const step of scanSteps(seen)) { /* preserve synchronous callers */ }
  return seen;
}

function stateOf(file) {
  return files.get(file) || null;
}

function allStates() {
  return files.values();
}

module.exports = { scan, scanSteps, stateOf, allStates };
