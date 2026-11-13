// 프로필 정의(~/.omp/agent/agents/<이름>.md)에서 모델 목록·사고 수준만 뽑는다. mtime 으로 캐시한다.
"use strict";

const fs = require("fs");
const path = require("path");
const { HOME } = require("./config");

const DIR = path.join(HOME, ".omp", "agent", "agents");
const cache = new Map(); // 이름 -> {mtime, prof}

// frontmatter 의 model 목록과 thinking-level 만 읽는다(전체 YAML 파서는 필요 없다).
function parse(raw) {
  const lines = raw.split(/\r?\n/);
  const out = { models: [], thinking: "" };
  if ((lines[0] || "").trim() !== "---") return out;
  let inModel = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const item = line.match(/^\s+-\s*(.+)$/);
    if (inModel && item) {
      out.models.push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) {
      inModel = false;
      continue;
    }
    inModel = kv[1] === "model";
    if (kv[1] === "thinking-level") out.thinking = kv[2].trim();
    else if (inModel && kv[2].trim()) out.models.push(kv[2].trim()); // model: 하나만 적은 형태
  }
  return out;
}

// 프로필 이름 -> {name, models, thinking}. 내장 이름(task·sonic 등)처럼 파일이 없으면 null.
function profileOf(name) {
  if (!name) return null;
  const file = path.join(DIR, name + ".md");
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(name);
  if (hit && hit.mtime === mtime) return hit.prof;
  let prof = null;
  try {
    prof = { name, ...parse(fs.readFileSync(file, "utf8")) };
  } catch {
    prof = null;
  }
  cache.set(name, { mtime, prof });
  return prof;
}

module.exports = { profileOf };
