// Claude Code 모델 선택: 카드(세션)별 --model 값을 data/claude-models.json 에 남긴다.
// 목록은 claude --help 가 말하는 별칭(opus·sonnet 등)이다. 상태는 이 모듈 하나가 소유한다.
"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT } = require("../config");

const DIR = process.env.OMP_MAP_STATE || path.join(ROOT, "data");
const FILE = path.join(DIR, "claude-models.json");
// 별칭(opus 등)은 설치된 Claude Code 버전에 따라 다른 모델로 풀린다(2.1.187 에서 opus → 4.8).
// 카드에 저장값이 없으면 정식 id 로 5.5 를 고른다.
const DEFAULT_MODEL = process.env.OMP_MAP_CLAUDE_MODEL || "default";
const ALIASES = [
  { id: DEFAULT_MODEL, name: "CLI 기본 모델" },
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

// 카드에 저장한 값(없으면 "")만 돌려준다. 실제 실행 모델은 호출자가 DEFAULT_MODEL 로 채운다.
const modelOf = (card) => map[norm(card)] || "";

const aliasOf = (id) => ALIASES.find((a) => a.id === id) || null;

function list(card) {
  const cur = modelOf(card) || DEFAULT_MODEL;
  const a = aliasOf(cur);
  return {
    ok: true,
    default: DEFAULT_MODEL,
    models: ALIASES.map((x) => ({ provider: "claude", id: x.id, name: x.name })),
    current: { provider: "claude", id: cur, name: (a && a.name) || cur },
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

module.exports = { modelOf, list, set, ALIASES, DEFAULT_MODEL };
