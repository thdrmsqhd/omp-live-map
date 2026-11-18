// 검증용 Claude 세션(메인 + 서브에이전트 2개)을 가짜 홈에 심는다. 실제 ~/.claude 는 건드리지 않는다.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { seedSession, sessionFile } = require("./fake-claude");

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const cwd = process.env.FAKE_CLAUDE_SEED_CWD || "C:\\workspace\\omp-live-map";
const id = crypto.randomUUID();
const file = seedSession(cwd, id, "가짜 Claude 기록", "이 세션의 대화 기록이 카드에 보이는지 확인해 주세요.",
  "가짜 기록입니다. Read 툴을 한 번 쓰고 본문을 남겼습니다.");

// 서브에이전트 기록: <sessionId>/subagents/agent-*.jsonl + .meta.json(agentType·description·finished).
function seedSub(agentId, agentType, description, finished) {
  const dir = path.join(path.dirname(file), id, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const sub = path.join(dir, "agent-" + agentId + ".jsonl");
  const now = Date.now();
  const recs = [
    { type: "user", isSidechain: true, agentId, sessionId: id, cwd, parentUuid: null,
      message: { role: "user", content: description }, uuid: crypto.randomUUID(), timestamp: new Date(now).toISOString() },
    { type: "assistant", isSidechain: true, agentId, sessionId: id, cwd,
      message: { model: "claude-haiku-5-5", role: "assistant", content: [{ type: "text", text: description + " 완료" }],
        usage: { input_tokens: 2, output_tokens: 40, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } },
      uuid: crypto.randomUUID(), timestamp: new Date(now + 1000).toISOString() },
  ];
  fs.writeFileSync(sub, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(sub.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    agentType, launchedWithDefaults: true, description, toolUseId: "toolu_" + agentId,
    spawnDepth: 1, requestShape: "background", requestNonInteractive: true, finished,
  }));
  return sub;
}

seedSub("live0000000000001", "verifier", "실행 중 서브 검증", false);
seedSub("done0000000000001", "Explore", "완료된 서브 탐색", true);
console.log(path.relative(home, file));
