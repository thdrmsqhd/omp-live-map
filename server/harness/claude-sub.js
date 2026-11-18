// Claude Code 서브에이전트 기록 읽기: <projects>/<슬러그>/<sessionId>/subagents/agent-*.jsonl (+ .meta.json).
// 메타의 agentType·description·toolUseId·finished 로 노드 이름·제목·실행 상태를 정한다. 원본은 읽기 전용.
"use strict";

const fs = require("fs");
const path = require("path");
const { newState, ingestLine } = require("./claude");

const MAX_PENDING = 1_048_576;
const cache = new Map(); // 파일 -> { offset, pending, st, metaMtime }

function metaOf(file) {
  try { return JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")) || {}; } catch { return {}; }
}

function readNew(rec) {
  let size;
  try { size = fs.statSync(rec.st.file).size; } catch { return; }
  if (size < rec.offset) { rec.offset = 0; rec.pending = ""; }
  if (size === rec.offset) return;
  const bytes = size - rec.offset;
  const buf = Buffer.allocUnsafe(bytes);
  const fd = fs.openSync(rec.st.file, "r");
  try { fs.readSync(fd, buf, 0, bytes, rec.offset); } finally { fs.closeSync(fd); }
  rec.offset = size;
  const lines = (rec.pending + buf.toString("utf8")).split("\n");
  rec.pending = lines.pop() || "";
  if (rec.pending.length > MAX_PENDING) rec.pending = "";
  for (const line of lines) if (line.trim()) ingestLine(rec.st, line);
}

function makeState(file, sessionId, mainFile) {
  const st = newState(file);
  Object.assign(st, {
    kind: "sub", name: path.basename(file, ".jsonl"), id: file, parent: mainFile, mainFile,
    sessionKey: "claude|" + sessionId, sessionId, depth: 3, sidechain: true,
    agent: "", agentModel: "", agentThinking: "", statusOverride: "",
  });
  return st;
}

// 한 세션의 서브 기록 폴더를 증분으로 읽는다. 기간 밖 파일은 건너뛴다.
function scanDir(dir, sessionId, mainFile, cutoff) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.mtimeMs < cutoff) continue;
    let rec = cache.get(file);
    if (!rec) {
      rec = { offset: 0, pending: "", st: makeState(file, sessionId, mainFile), metaMtime: 0 };
      cache.set(file, rec);
    }
    const st = rec.st;
    st.mainFile = mainFile;
    st.parent = mainFile;
    try {
      const mm = fs.statSync(file.replace(/\.jsonl$/, ".meta.json")).mtimeMs;
      if (mm !== rec.metaMtime) {
        rec.metaMtime = mm;
        applyMeta(st, metaOf(file));
      }
    } catch { /* 메타가 없으면 파일명·기록만 쓴다 */ }
    if (!st.lastTs) st.lastTs = stat.mtimeMs;
    readNew(rec);
    if (!st.title) st.title = (st.firstUser || st.name).slice(0, 120);
    if (!st.agentModel) st.agentModel = st.model;
  }
}

function applyMeta(st, m) {
  if (m.agentType) { st.agent = String(m.agentType); st.name = st.agent; }
  if (m.description) st.title = String(m.description);
  st.toolUseId = m.toolUseId ? String(m.toolUseId) : "";
  if (m.finished === true) { st.finished = true; st.statusOverride = "done"; }
  else if (m.finished === false) { st.finished = false; st.statusOverride = "live"; }
  else st.statusOverride = "";
}

module.exports = { scanDir, states: () => [...cache.values()].map((r) => r.st) };
