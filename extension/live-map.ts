// omp-live-map 확장: 세션의 실시간 활동을 ~/.omp/live-map/<세션>.jsonl 로 흘린다.
// server/ext-live.js 가 이 파일을 tail 해 SSE live 이벤트로 방송한다(계약: node=기록 경로, kind=text|think|out|turn_end).
// TUI 와 같은 프로세스에서 도므로 절대 던지지 않고, 디스크 쓰기는 큐로 묶은 비동기 append 만 쓴다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".omp", "live-map");
const MAX_BYTES = 2 * 1024 * 1024; // 넘으면 파일을 새로 시작한다(서버는 크기 감소를 보고 처음부터 다시 읽는다)
const MAX_TEXT = 8000; // 레코드 한 개의 글자 수 상한(끝쪽을 남긴다)
const MAX_QUEUE = 400; // 아직 못 쓴 줄 수 상한(넘으면 오래된 줄부터 버린다)
const FLUSH_MS = 40; // 글자 조각이 몰려와도 이 간격으로 모아 한 번에 쓴다

type Obj = Record<string, unknown>;
type Pi = {
  on(event: string, handler: (event: unknown, ctx: unknown) => void): void;
  setLabel?: (label: string) => void;
};
type Sink = { file: string; queue: string[]; busy: boolean; timer: unknown; size: number; lastOut: Map<string, string>; lens: Map<string, number> };

const sinks = new Map<string, Sink>();
const asObj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
// 세션 파일 경로 → 파일 이름. 경로 구분자·대소문자 차이로 같은 세션이 두 파일이 되지 않게 정규화한다.
function safeName(file: string): string {
  const key = String(file).replace(/\\/g, "/").toLowerCase();
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  const base = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "session";
  return `${base}-${h.toString(36)}`;
}

function sinkFor(file: string): Sink | null {
  const name = safeName(file);
  const hit = sinks.get(name);
  if (hit) return hit;
  let size = 0;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    size = fs.statSync(path.join(DIR, name + ".jsonl")).size;
  } catch {
    /* 첫 세션이면 파일이 없다 */
  }
  const sink: Sink = { file: path.join(DIR, name + ".jsonl"), queue: [], busy: false, timer: null, size, lastOut: new Map(), lens: new Map() };
  sinks.set(name, sink);
  return sink;
}

function schedule(sink: Sink) {
  if (sink.timer) return;
  sink.timer = setTimeout(() => {
    sink.timer = null;
    try { flush(sink); } catch { /* TUI 를 막지 않는다 */ }
  }, FLUSH_MS);
  const handle = sink.timer as { unref?: () => void };
  if (typeof handle?.unref === "function") handle.unref();
}

function flush(sink: Sink) {
  if (sink.busy || !sink.queue.length) return;
  const chunk = sink.queue.join("");
  sink.queue.length = 0;
  const bytes = Buffer.byteLength(chunk);
  if (sink.size + bytes > MAX_BYTES) {
    try { fs.unlinkSync(sink.file); } catch {}
    sink.size = 0;
  }
  sink.size += bytes;
  sink.busy = true;
  fs.promises
    .appendFile(sink.file, chunk, "utf8")
    .catch(() => {})
    .then(() => {
      sink.busy = false;
      if (sink.queue.length) schedule(sink);
    });
}

function put(sink: Sink | null, rec: Obj) {
  if (!sink) return;
  let line: string;
  try {
    line = JSON.stringify(rec) + "\n";
  } catch {
    return;
  }
  sink.queue.push(line);
  if (sink.queue.length > MAX_QUEUE) sink.queue.splice(0, sink.queue.length - MAX_QUEUE);
  schedule(sink);
}

// delta 가 없고 전체 글만 오면 직전 길이와 비교해 늘어난 부분만 돌려준다(맵 서버와 같은 규칙).
function growth(sink: Sink, ev: Obj, kind: "text" | "think"): string {
  if (typeof ev.delta === "string" && ev.delta) return ev.delta;
  const i = typeof ev.contentIndex === "number" ? ev.contentIndex : 0;
  const partial = asObj(ev.partial);
  const arr = partial && Array.isArray(partial.content) ? partial.content : [];
  const part = asObj(arr[i]);
  const full = part ? part[kind === "think" ? "thinking" : "text"] : null;
  if (typeof full !== "string") return "";
  const key = kind + ":" + i;
  const prev = sink.lens.get(key) || 0;
  sink.lens.set(key, full.length);
  return full.length > prev ? full.slice(prev) : "";
}

export default function liveMap(pi: Pi) {
  pi.setLabel?.("Live map bridge");

  // 세션 파일 경로는 세션 전환·브랜치에서 바뀔 수 있어 이벤트마다 다시 읽는다(못 읽으면 마지막 값을 쓴다).
  let current = "";
  const nodeOf = (ctx: unknown): string => {
    const sm = asObj(asObj(ctx)?.sessionManager);
    const get = sm ? sm.getSessionFile : null;
    if (typeof get !== "function") return current;
    try {
      const file = Reflect.apply(get as (...args: unknown[]) => unknown, sm, []);
      if (typeof file === "string" && file) current = file;
    } catch {
      /* 세션 매니저가 아직 없을 수 있다 */
    }
    return current;
  };
  const sinkOf = (ctx: unknown): Sink | null => {
    const node = nodeOf(ctx);
    if (!node) return null;
    try {
      return sinkFor(node);
    } catch {
      return null;
    }
  };
  // 세션 파일 경로가 바뀌는 지점에서 새 경로를 잡아 둔다.
  for (const name of ["session_start", "session_switch", "session_branch"]) pi.on(name, (_e, ctx) => void nodeOf(ctx));

  // 에이전트 글·생각: 늘어난 조각만 보낸다. 화면은 같은 종류가 연속이면 이어 붙인다.
  pi.on("message_update", (e, ctx) => {
    const ev = asObj(asObj(e)?.assistantMessageEvent);
    if (!ev) return;
    const kind = ev.type === "text_delta" ? "text" : ev.type === "thinking_delta" ? "think" : null;
    if (!kind) return;
    const sink = sinkOf(ctx);
    if (!sink) return;
    const add = growth(sink, ev, kind);
    if (add) put(sink, { t: Date.now(), node: current, kind, text: add.length > MAX_TEXT ? add.slice(-MAX_TEXT) : add });
  });

  // 메시지가 끝나면 글 길이 표를 비운다(다음 메시지가 같은 index 로 다시 시작한다).
  pi.on("message_end", () => {
    for (const s of sinks.values()) s.lens.clear();
  });

  // 툴 진행 프레임: 그 툴이 지금까지 낸 출력 전체(끝쪽)를 보낸다. 화면은 같은 id 의 출력을 교체한다.
  pi.on("tool_execution_update", (e, ctx) => {
    const ev = asObj(e);
    if (!ev || typeof ev.toolCallId !== "string" || !ev.toolCallId) return;
    const sink = sinkOf(ctx);
    if (!sink) return;
    // 진행 프레임의 content 에서 글자만 모은다.
    const partial = asObj(ev.partialResult);
    const parts = partial && Array.isArray(partial.content) ? partial.content : [];
    let text = "";
    for (const p of parts) {
      const o = asObj(p);
      if (o && o.type === "text" && typeof o.text === "string") text += o.text;
    }
    if (!text) return;
    const body = text.length > MAX_TEXT ? text.slice(-MAX_TEXT) : text;
    if (sink.lastOut.get(ev.toolCallId) === body) return; // 같은 줄이 두 번 와도 한 번만 쓴다
    sink.lastOut.set(ev.toolCallId, body);
    put(sink, { t: Date.now(), node: current, kind: "out", id: ev.toolCallId, name: ev.toolName, text: body });
  });

  pi.on("tool_execution_end", (e) => {
    const id = asObj(e)?.toolCallId;
    if (typeof id !== "string" || !id) return;
    for (const s of sinks.values()) s.lastOut.delete(id);
  });

  // 턴이 끝나면 열린 툴 표시를 닫는다(화면 규칙: turn_end).
  pi.on("agent_end", (_e, ctx) => {
    const sink = sinkOf(ctx);
    if (sink) put(sink, { t: Date.now(), node: current, kind: "turn_end" });
    for (const s of sinks.values()) s.lens.clear();
  });

  // 종료 경로: 남은 줄은 동기로 한 번에 쓴다(40ms 타이머를 기다릴 수 없다).
  pi.on("session_shutdown", () => {
    for (const s of sinks.values()) {
      if (s.timer) {
        try { clearTimeout(s.timer as Parameters<typeof clearTimeout>[0]); } catch {}
        s.timer = null;
      }
      if (!s.queue.length) continue;
      const chunk = s.queue.join("");
      s.queue.length = 0;
      try { fs.appendFileSync(s.file, chunk); } catch {}
    }
  });
}
