// Claude Code 모델 선택: 카드(세션)별 --model 값을 data/claude-models.json 에 남긴다.
// 목록은 claude --help 가 말하는 별칭(opus·sonnet 등)이다. 상태는 이 모듈 하나가 소유한다.
"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT } = require("../config");

const DIR = process.env.OMP_MAP_STATE || path.join(ROOT, "data");
const FILE = path.join(DIR, "claude-models.json");
const ALIASES = [
  { id: "sonnet", name: "Sonnet" },
  { id: "opus", name: "Opus" },
  { id: "haiku", name: "Haiku" },
  { id: "fable", name: "Fable" },
];
const norm = (p) => path.normalize(String(p || "")).toLowerCase();
const VALID = /^[A-Za-z0-9._:-]{1,80}$/;

let map = load();

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch { return {}; }
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(map));
  } catch { /* 저장 실패는 이번 실행의 선택만 잃는다 */ }
}

const modelOf = (card) => map[norm(card)] || "";

function list(card) {
  const cur = modelOf(card);
  return {
    ok: true,
    models: ALIASES.map((a) => ({ provider: "claude", id: a.id, name: a.name })),
    current: cur ? { provider: "claude", id: cur, name: cur } : null,
  };
}

// 모델 하나를 저장한다. 별칭·전체 모델 이름 모두 받되 셸 인자로 안전한 글자만 허용한다.
function set(card, id) {
  const v = String(id || "").trim();
  if (!VALID.test(v)) return { ok: false, out: "모델 id 형식 오류" };
  map[norm(card)] = v;
  save();
  return { ok: true, model: { provider: "claude", id: v, name: v } };
}

module.exports = { modelOf, list, set, ALIASES };
