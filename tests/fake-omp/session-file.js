// 가짜 omp 의 세션 기록(jsonl): 맵의 tail 이 읽는 형식으로 만들고 덧붙인다.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const iso = (ms) => new Date(ms).toISOString();

let seq = 0; // 같은 ms 에 두 세션을 만들어도 파일명이 겹치지 않게

function write(file, obj) {
  try {
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  } catch {}
}

// resume 경로가 있으면 그 파일을 잇고, 없으면 가짜 홈 아래에 새로 만든다.
function makeSession(resumePath, cwd) {
  if (resumePath) {
    const file = path.normalize(resumePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, "");
    return { file, id: path.basename(file, ".jsonl"), append: (o) => write(file, o) };
  }
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const dir = path.join(home, ".omp", "agent", "sessions", "--C--fake--");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const id = "fake-" + now + "-" + ++seq;
  const file = path.join(dir, iso(now).replace(/[:.]/g, "-") + "_" + id + ".jsonl");
  const lines = [
    { type: "session", id, cwd, timestamp: iso(now) },
    { type: "title", title: "가짜 omp 세션", timestamp: iso(now) },
    { type: "model_change", timestamp: iso(now), model: "fake/fake-1" },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { file, id, append: (o) => write(file, o) };
}

module.exports = { makeSession, iso };
