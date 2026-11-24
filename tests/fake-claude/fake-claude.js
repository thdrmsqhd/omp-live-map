// 가짜 claude: `claude -p --output-format stream-json --include-partial-messages` 를 흉내 낸다.
// 표준입력의 프롬프트를 받아 Claude Code 세션 기록(<홈>/.claude/projects/<슬러그>/<id>.jsonl)을 쓰고,
// system init → stream_event 델타 → assistant → result 순서로 stdout 에 낸다. 검증용이며 실서비스가 아니다.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] || "" : ""; };

const home = process.env.FAKE_CLAUDE_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir();
const slug = (cwd) => String(cwd || "").replace(/[^A-Za-z0-9]/g, "-");
const sessionFile = (cwd, id) => path.join(home, ".claude", "projects", slug(cwd), id + ".jsonl");

// 기록 한 줄을 덧붙인다(디렉터리가 없으면 만든다).
function append(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

// seed.js 도 쓰는 기록 작성기: user → assistant(툴) → assistant(본문) → cost-state 한 세션을 새로 만든다.
function seedSession(cwd, id, title, prompt, reply) {
  const file = sessionFile(cwd, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  let t = Date.now() - 60_000;
  const at = () => iso((t += 5_000));
  const base = { sessionId: id, cwd, version: "fake", gitBranch: "main" };
  append(file, { ...base, type: "custom-title", customTitle: title, timestamp: at() });
  append(file, { ...base, type: "user", parentUuid: null, isSidechain: false, message: { role: "user", content: prompt }, uuid: crypto.randomUUID(), timestamp: at() });
  append(file, { ...base, type: "assistant", message: { model: "claude-fake-1", role: "assistant", content: [
    { type: "text", text: "기록을 확인합니다." },
    { type: "tool_use", id: "t1", name: "Read", input: { file_path: path.join(cwd, "README.md") } },
  ], usage: { input_tokens: 4, output_tokens: 120, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 800 } }, uuid: crypto.randomUUID(), timestamp: at() });
  append(file, { ...base, type: "assistant", message: { model: "claude-fake-1", role: "assistant", content: [{ type: "text", text: reply }],
    usage: { input_tokens: 2, output_tokens: 300, cache_read_input_tokens: 12_000, cache_creation_input_tokens: 300 } }, uuid: crypto.randomUUID(), timestamp: at() });
  append(file, { ...base, type: "cost-state", totalCostUSD: 0.0421, timestamp: at() });
  return file;
}

if (require.main === module) main();

function main() {
  if (!argv.includes("-p") && !argv.includes("--print")) {
    process.stderr.write("fake claude: -p 모드만 지원합니다\n");
    process.exit(2);
  }
  const resume = argOf("--resume");
  const id = resume || argOf("--session-id") || crypto.randomUUID();
  const cwd = process.cwd();
  const file = sessionFile(cwd, id);
  const model = argOf("--model") || "claude-fake-1";
  const streamIn = argv.includes("--input-format") && argOf("--input-format") === "stream-json";
  const log = process.env.FAKE_CLAUDE_LOG || "";
  const out = (frame) => {
    if (log) { try { fs.appendFileSync(log, JSON.stringify(frame) + "\n"); } catch {} }
    process.stdout.write(JSON.stringify(frame) + "\n");
  };
  const logIn = (o) => { if (log) { try { fs.appendFileSync(log, JSON.stringify({ type: "fake-input", ...o }) + "\n"); } catch {} } };

  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => run(parseInput(raw)));
  process.stdin.on("error", () => {});
  process.on("SIGTERM", () => process.exit(143));
  process.on("SIGINT", () => process.exit(130));

  // stream-json 입력 한 줄(이미지 content 블록 포함)을 글·이미지 수로 바꾼다.
  function parseInput(buf) {
    const t = buf.trim();
    if (!streamIn || !t.startsWith("{")) { logIn({ text: t, images: 0 }); return { text: t, images: 0 }; }
    let text = "", images = 0;
    for (const line of t.split("\n")) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      for (const b of (o.message && Array.isArray(o.message.content)) ? o.message.content : []) {
        if (b.type === "text") text += b.text;
        else if (b.type === "image") images += 1;
      }
    }
    logIn({ text, images });
    return { text, images };
  }

  async function run(input) {
    const { text, images } = input;
    const now = Date.now();
    if (!resume) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "");
      append(file, { type: "custom-title", sessionId: id, timestamp: iso(now), customTitle: "가짜 Claude 세션" });
    }
    append(file, { type: "user", sessionId: id, cwd, isSidechain: false, parentUuid: null,
      uuid: crypto.randomUUID(), timestamp: iso(now), message: { role: "user", content: text } });
    out({ type: "system", subtype: "init", session_id: id, cwd, model, tools: ["Read", "Bash", "AskUserQuestion"] });
    const delay = Number(process.env.FAKE_CLAUDE_DELAY || 25);
    const usage = { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 1_200, cache_creation_input_tokens: 240 };

    // ask 검증: 글에 ask 가 들어온 첫 요청이면 AskUserQuestion tool_use 를 내고 끝낸다.
    if (process.env.FAKE_CLAUDE_ASK && /ask/i.test(text) && !text.startsWith("질문에 대한 답")) {
      const blocks = [{ type: "tool_use", id: "toolu_fake_ask", name: "AskUserQuestion", input: { questions: [
        { question: "어떤 방식을 고를까요?", header: "방식", multiSelect: false,
          options: [{ label: "A안", description: "첫 번째 방식" }, { label: "B안", description: "두 번째 방식" }] },
      ] } }];
      const msg = { model, role: "assistant", content: blocks, usage };
      append(file, { type: "assistant", sessionId: id, cwd, isSidechain: false, message: msg, uuid: crypto.randomUUID(), timestamp: iso(Date.now()) });
      out({ type: "assistant", session_id: id, message: msg });
      out({ type: "result", subtype: "success", is_error: false, session_id: id, result: "" });
      return;
    }

    const reply = (process.env.FAKE_CLAUDE_REPLY || "가짜 Claude 응답입니다. 스트리밍 출력 확인용입니다. ")
      + (text ? "(" + text.slice(0, 20) + ")" : "") + (images ? " [이미지 " + images + "개]" : "");
    for (const chunk of reply.match(/[\s\S]{1,6}/g) || []) {
      out({ type: "stream_event", session_id: id, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } } });
      await sleep(delay);
    }
    const replyUsage = { ...usage, output_tokens: reply.length };
    append(file, { type: "assistant", sessionId: id, cwd, isSidechain: false,
      message: { model, role: "assistant", content: [{ type: "text", text: reply }], usage: replyUsage },
      uuid: crypto.randomUUID(), timestamp: iso(Date.now()) });
    append(file, { type: "cost-state", sessionId: id, totalCostUSD: 0.0123, timestamp: iso(Date.now()) });
    out({ type: "assistant", session_id: id, message: { model, role: "assistant", content: [{ type: "text", text: reply }], usage: replyUsage } });
    out({ type: "result", subtype: "success", is_error: false, session_id: id, result: reply, total_cost_usd: 0.0123 });
  }
}

module.exports = { seedSession, sessionFile, slug };
