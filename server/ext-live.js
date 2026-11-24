// 확장 실시간 기록: ~/.omp/live-map/*.jsonl 을 tail 해 SSE live 이벤트로 방송한다.
// 기록은 extension/live-map.ts(omp 확장)가 세션마다 한 파일로 쓴다. 맵이 띄운 rpc 세션은 프레임이 원천이므로 건너뛴다.
"use strict";

const fs = require("fs");
const path = require("path");
const { HOME } = require("./config");
const { pushLive } = require("./sse");
const { has } = require("./sessions");

const DIR = path.join(HOME, ".omp", "live-map");
const TICK = 300; // 확장은 40ms 간격으로 모아 쓰므로 이 주기면 충분히 실시간이다
const FRESH_MS = 600_000; // 맵을 새로 켜도 최근 10분 활동은 되살린다(그보다 오래된 줄은 버린다)
const FIRST_BYTES = 65_536; // 처음 보는 파일은 끝쪽 이만큼만 읽는다(긴 과거를 다시 방송하지 않게)
const MAX_TEXT = 20_000;
const MAX_PENDING = 65_536; // 줄이 잘린 채 쌓이는 경우의 상한
const files = new Map(); // file -> { file, offset, pending }
const recent = new Map(); // node 키 -> [{ev, at}] 최근 이벤트(새로 붙은 화면이 되살린다)
const RECENT_MAX = 120; // 노드당 보관 수
const RECENT_NODES = 200; // 보관 노드 수
const RECENT_MS = 600_000; // 되살리는 시간

const nodeKey = (node) => String(node || "").replace(/\\/g, "/").toLowerCase();

// 방송하고, 나중에 붙은 화면이 볼 수 있게 최근 것도 남긴다.
function push(ev) {
  pushLive(ev);
  const key = nodeKey(ev.node);
  const list = recent.get(key) || [];
  list.push({ ev, at: Date.now(), name: ev.name });
  if (list.length > RECENT_MAX) list.splice(0, list.length - RECENT_MAX);
  recent.delete(key); // 최근 쓴 노드가 뒤로 가게 순서를 다시 잡는다
  recent.set(key, list);
  while (recent.size > RECENT_NODES) recent.delete(recent.keys().next().value);
}

// 새 SSE 클라이언트에 보여줄 최근 이벤트. 출력(out)은 툴 줄이 있어야 화면에 붙으므로 먼저 하나 붙인다.
function recentFor(node) {
  const list = recent.get(nodeKey(node));
  if (!list) return [];
  const now = Date.now();
  const out = [];
  const seen = new Set();
  const ended = new Set();
  for (const x of list) {
    if (now - x.at > RECENT_MS) continue;
    const ev = x.ev;
    if (ev.kind === "out" && ev.id && !seen.has(ev.id)) {
      seen.add(ev.id);
      out.push({ node: ev.node, kind: "tool", id: ev.id, name: typeof x.name === "string" ? x.name : "", args: "" });
    }
    // 턴이 끝났는데 닫히지 않은 툴은 끝난 것으로 본다(되살린 화면에 "실행 중"이 남지 않게).
    if (ev.kind === "turn_end") {
      for (const id of seen) {
        if (ended.has(id)) continue;
        ended.add(id);
        out.push({ node: ev.node, kind: "tool_end", id, error: false });
      }
    }
    out.push(ev);
  }
  return out;
}

// 한 줄을 기존 live 이벤트 모양({node, kind, id?, text?})으로 바꿔 방송한다.
function emit(rec) {
  if (!rec || typeof rec !== "object" || !rec.node || !rec.kind) return;
  if (typeof rec.t === "number" && Date.now() - rec.t > FRESH_MS) return;
  const node = String(rec.node);
  if (has(node)) return; // 맵이 잡고 있는 rpc 세션은 server/live.js 가 방송한다(중복 금지)
  if (rec.kind === "text" || rec.kind === "think") {
    const text = typeof rec.text === "string" ? rec.text.slice(-MAX_TEXT) : "";
    if (text) push({ node, kind: rec.kind, text });
    return;
  }
  if (rec.kind === "out") {
    if (!rec.id) return;
    push({ node, kind: "out", id: String(rec.id), name: typeof rec.name === "string" ? rec.name : "", text: typeof rec.text === "string" ? rec.text.slice(-MAX_TEXT) : "" });
    return;
  }
  if (rec.kind === "turn_end") push({ node, kind: "turn_end", ...(typeof rec.t === "number" ? { ts: rec.t } : {}) }); // ts: 화면이 늦게 온 툴 시작을 이 턴 쪽에 놓는 기준
}

// 늘어난 바이트만 읽어 줄 단위로 방송한다. 확장이 파일을 새로 시작하면(크기 감소) 처음부터 다시 읽는다.
function readNew(st) {
  let size;
  try {
    size = fs.statSync(st.file).size;
  } catch {
    return;
  }
  if (size < st.offset) {
    st.offset = 0;
    st.pending = "";
  }
  if (size === st.offset) return;
  const bytes = size - st.offset;
  const buf = Buffer.allocUnsafe(bytes);
  const fd = fs.openSync(st.file, "r");
  try {
    fs.readSync(fd, buf, 0, bytes, st.offset);
  } finally {
    fs.closeSync(fd);
  }
  st.offset = size;
  const lines = (st.pending + buf.toString("utf8")).split("\n");
  st.pending = lines.pop() || "";
  if (st.pending.length > MAX_PENDING) st.pending = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      emit(JSON.parse(line));
    } catch {
      /* 잘린 줄은 버린다 */
    }
  }
}

function track(file) {
  if (files.has(file)) return;
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  files.set(file, { file, offset: Math.max(0, size - FIRST_BYTES), pending: "" });
}

function tick() {
  let names;
  try {
    names = fs.readdirSync(DIR);
  } catch {
    return; // 폴더가 아직 없다(확장이 한 번도 안 돌았다)
  }
  const seen = new Set();
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(DIR, name);
    seen.add(file);
    track(file);
    const st = files.get(file);
    if (st) {
      try { readNew(st); } catch { /* file rotated mid-read */ }
    }
  }
  for (const file of files.keys()) if (!seen.has(file)) files.delete(file);
}

function start() {
  tick();
  const timer = setInterval(tick, TICK);
  timer.unref?.();
}

module.exports = { start, tick, recentFor };
