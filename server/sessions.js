// 맵 세션 등록부: 맵이 띄운 omp rpc 프로세스 소유, 프롬프트 전송·steer·취소·종료, SSE chat 방송, 프레임을 live 로 전달.
"use strict";

const fs = require("fs");
const path = require("path");
const { HOME } = require("./config");
const { open } = require("./rpc");
const { stateOf } = require("./tail");
const { isHeld } = require("./omp-lease");
const lineage = require("./lineage");
const harness = require("./harness");
const claudeRun = require("./harness/claude-run");
const { pushChat } = require("./sse");
const live = require("./live");
const uiReq = require("./ui-requests");

// card(맵 카드 id, 비우기 전 처음 파일) -> { rpc, node(지금 실제 파일), busy, ... }
const sessions = new Map();
const opening = new Map(); // card -> 이어 붙이는 중인 Promise (같은 세션을 두 번 띄우지 않는다)

const errText = (e) => String((e && e.message) || e);

// 한 차례(프롬프트 → 에이전트 종료)를 닫고 chat done 을 보낸다. 취소로 끝났으면 130.
function finish(s, code) {
  if (!s.busy) return;
  const cancelled = s.cancelled;
  s.busy = false; s.running = false; s.cancelled = false;
  pushChat({ node: s.card || s.node, kind: "done", text: s.full, code: cancelled ? 130 : code, ...(cancelled ? { cancelled: true } : {}) });
  s.full = "";
}

function onFrame(s, e) {
  if (s.node) { try { live.handle(s.node, e); } catch {} }
  const ev = e.assistantMessageEvent;
  if (e.type === "message_update" && ev && ev.type === "text_delta" && ev.delta) {
    s.full = (s.full + ev.delta).slice(-4000);
    pushChat({ node: s.card || s.node, kind: "delta", text: ev.delta });
  } else if (e.type === "agent_start") {
    // 백그라운드 잡이 끝나 에이전트가 스스로 다시 도는 경우도 busy 로 본다.
    if (!s.busy) s.full = "";
    s.busy = true;
    s.running = true;
  } else if (e.type === "agent_end") {
    finish(s, 0);
  } else if (e.type === "prompt_result" && e.agentInvoked === false && !s.running) {
    // 에이전트를 부르지 않고 끝난 프롬프트(슬래시 명령 등)는 agent_end 가 오지 않는다.
    finish(s, 0);
  }
}

// omp 를 띄워 등록한다. resume 이 없으면 get_state 의 sessionFile 이 node 가 된다.
async function start(cwd, resume) {
  const rpc = open({ cwd, resume });
  const s = { rpc, node: resume || "", card: resume || "", busy: false, running: false, cancelled: false, closing: false, full: "" };
  rpc.onEvent((e) => onFrame(s, e));
  try {
    const [, st] = await Promise.all([
      rpc.send({ type: "set_subagent_subscription", level: "events" }),
      rpc.send({ type: "get_state" }),
    ]);
    const file = st.success && st.data && st.data.sessionFile;
    if (!s.node && file) s.node = path.normalize(file);
    if (!s.node) throw new Error("omp 가 세션 파일을 알려 주지 않았습니다");
  } catch (e) {
    rpc.close();
    throw e;
  }
  s.card = lineage.cardOf(s.node) || s.node;
  sessions.set(s.card, s);
  uiReq.bind(s);
  rpc.child.on("close", () => {
    if (sessions.get(s.card) === s) sessions.delete(s.card);
    finish(s, 1);
  });
  return s;
}

// 프롬프트를 보낸다. 도는 중이면 steer 로 끼워 넣는다. 응답(접수)만 기다리고 끝은 기다리지 않는다.
// images: omp RPC ImageContent 배열([{ type: "image", data, mimeType }]). 없으면 싣지 않는다.
async function sendPrompt(s, text, images) {
  const steer = s.busy;
  const cmd = { type: "prompt", message: text };
  if (images && images.length) cmd.images = images;
  if (steer) cmd.streamingBehavior = "steer";
  else { s.busy = true; s.full = ""; }
  pushChat({ node: s.card || s.node, kind: "req", text });
  try {
    const r = await s.rpc.send(cmd);
    if (!r.success) throw new Error(r.error || "omp 가 프롬프트를 받지 않았습니다");
    return { ok: true, node: s.node };
  } catch (e) {
    if (!steer) finish(s, 1);
    return { ok: false, out: errText(e) };
  }
}

// 기존 세션 기록에 맵 프로세스를 이어 붙인다. 터미널이 쓰는 세션이면 null.
async function attach(st) {
  if (st.id && await isHeld(st.id)) return null;
  return start(st.cwd && fs.existsSync(st.cwd) ? st.cwd : HOME, st.file);
}

// 새 세션. kind 는 하네스 id("omp" 기본, "claude").
async function newSession(cwd, text, images, kind) {
  if (kind === "claude") return claudeRun.newSession(cwd, text, images);
  const dir = cwd || HOME;
  let stat = null;
  try { stat = fs.statSync(dir); } catch { /* 없음 */ }
  if (!stat || !stat.isDirectory()) return { ok: false, out: "폴더 없음: " + dir };
  let s;
  try { s = await start(dir, null); } catch (e) { return { ok: false, out: errText(e) }; }
  if (!text) return { ok: true, node: s.node };
  const r = await sendPrompt(s, text, images);
  if (!r.ok) stopSession(s.node);
  return r;
}

function stopSession(node) {
  if (harness.of(lineage.resolve(node)) === "claude") return claudeRun.stop(node);
  const s = sessions.get(lineage.cardOf(node) || node);
  if (!s) return { ok: false, out: "맵이 띄운 세션이 아닙니다" };
  s.closing = true;
  if (s.busy) s.cancelled = true;
  s.rpc.close();
  return { ok: true };
}

// 맵이 쥔 세션을 돌려준다. 없으면 기존 기록에 이어 붙인다. 실패하면 { err: 응답 본문 }.
async function acquire(node) {
  const card = lineage.cardOf(node) || node;
  let s = sessions.get(card);
  if (!s) {
    const st = stateOf(lineage.resolve(card));
    if (!st) return { err: { ok: false, out: "세션 기록 없음" } };
    let p = opening.get(card);
    if (!p) {
      p = attach(st).finally(() => opening.delete(card));
      opening.set(card, p);
    }
    try { s = await p; } catch (e) { return { err: { ok: false, out: errText(e) } }; }
    if (!s) return { err: { ok: false, held: true, out: "터미널에서 사용 중인 세션입니다" } };
  }
  if (s.closing) return { err: { ok: false, out: "세션을 끝내는 중입니다" } };
  return { s };
}

async function prompt(node, text, images) {
  if (harness.of(lineage.resolve(node)) === "claude") return claudeRun.prompt(node, text, images);
  const { s, err } = await acquire(node);
  return err || sendPrompt(s, text, images);
}

async function cancel(node) {
  if (harness.of(lineage.resolve(node)) === "claude") return claudeRun.cancel(node);
  const s = sessions.get(lineage.cardOf(node) || node);
  if (!s || !s.busy) return { ok: false, out: "실행 중인 프롬프트 없음" };
  s.cancelled = true;
  try {
    const r = await s.rpc.send({ type: "abort" });
    if (!r.success) throw new Error(r.error || "omp 가 취소를 받지 않았습니다");
  } catch (e) {
    s.cancelled = false;
    return { ok: false, out: errText(e) };
  }
  // abort 뒤 agent_end 가 오지 않아도 화면이 전송 중으로 남지 않게 한다.
  setTimeout(() => { if (s.cancelled) finish(s, 130); }, 3000).unref();
  return { ok: true };
}

// 이 세션 파일을 맵이 띄운 rpc 프로세스가 잡고 있는가(그러면 실시간 이벤트는 rpc 프레임이 원천이다).
function has(node) {
  if (!node) return false;
  return sessions.has(lineage.cardOf(node) || node);
}

// 하네스 전환: 대상 omp 프로세스를 원래 카드 id 로 옮긴다. 그 뒤 프롬프트는 카드 id 로 온다.
function adopt(file, card) {
  const key = lineage.cardOf(file) || file;
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);
  s.card = card;
  sessions.set(card, s);
}

// 이 카드에서 지금 응답을 만들고 있는가(하네스 무관). 전환·비우기가 도는 턴을 막는 데 쓴다.
function busyOf(node) {
  const card = lineage.cardOf(node) || node;
  if (harness.of(lineage.resolve(card)) === "claude") return !!claudeRun.isBusy(card);
  const s = sessions.get(card) || sessions.get(lineage.resolve(card));
  return !!(s && s.busy);
}

function list() {
  return [
    ...[...sessions.values()].map((s) => ({ node: s.card, file: s.node, harness: "omp", pid: s.rpc.child.pid, busy: s.busy })),
    ...claudeRun.list(),
  ];
}

module.exports = { newSession, stopSession, prompt, cancel, list, acquire, has, adopt, busyOf };
