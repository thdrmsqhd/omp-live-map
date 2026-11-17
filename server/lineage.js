// 비우기 계보: 카드 id(처음 세션 파일 경로) → 지금 실제 기록 파일.
// 컨텍스트를 비우면 omp 는 새 세션 파일을 만들지만, 맵은 카드 id 를 처음 파일로 고정하고
// 실제 파일은 이 계보로 해석한다. 계보는 서버 데이터 파일에 남겨 재시작해도 유지된다.
"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT, SESSIONS } = require("./config");

const DIR = process.env.OMP_MAP_STATE || path.join(ROOT, "data");
const FILE = path.join(DIR, "clear-lineage.json");
const norm = (p) => path.normalize(String(p || "")).toLowerCase();

const entries = new Map(); // norm(카드 id) -> { card, file, key, prev: [] }
let byFile = new Map();    // norm(파일: 카드·현재·이전) -> norm(카드 id)

// 카드 파일(<folder>/<session>.jsonl)의 세션 키. ingest 와 같은 규칙이라 같은 클러스터로 묶인다.
function keyOfFile(file) {
  const rel = path.relative(SESSIONS, file).split(path.sep);
  return rel[0] + "|" + (rel[1] || "");
}

function index() {
  byFile = new Map();
  for (const e of entries.values()) {
    byFile.set(norm(e.card), norm(e.card));
    byFile.set(norm(e.file), norm(e.card));
    for (const p of e.prev) byFile.set(norm(p), norm(e.card));
  }
}

function load() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return; }
  for (const e of (raw && raw.cards) || []) {
    if (!e || !e.card || !e.file) continue;
    entries.set(norm(e.card), { card: e.card, file: e.file, key: e.key || keyOfFile(e.card), prev: Array.isArray(e.prev) ? e.prev : [] });
  }
  index();
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ cards: [...entries.values()] }));
  } catch { /* 저장 실패는 이번 실행의 계보만 잃는다 */ }
}

function entryOf(file) {
  const card = byFile.get(norm(file));
  return card ? entries.get(card) : null;
}

// 요청이 온 카드 id 를 지금 실제 파일로.
function resolve(file) {
  const e = entryOf(file);
  return e ? e.file : file;
}

// 파일(현재·이전·카드)이 속한 카드 id. 계보에 없으면 "".
function cardOf(file) {
  const e = entryOf(file);
  return e ? e.card : "";
}

// 비우기 전 기록처럼 맵에서 감춰야 하는 파일인가.
function isHidden(file) {
  const e = entryOf(file);
  return !!e && norm(e.file) !== norm(file);
}

// 파일이 속한 클러스터 키. 계보에 없으면 ""(호출자가 원래 키를 쓴다).
function sessionKeyOf(file) {
  const e = entryOf(file);
  return e ? e.key : "";
}

// 카드 id 의 실제 파일을 새 파일로 옮긴다. 이전 파일은 계보에 남겨 숨긴다.
function record(card, file, key) {
  if (!card || !file) return;
  let e = entries.get(norm(card));
  if (!e) e = { card, file: card, key: key || keyOfFile(card), prev: [] };
  if (norm(e.file) !== norm(file)) {
    if (e.prev.every((p) => norm(p) !== norm(e.file))) e.prev.push(e.file);
    e.file = file;
  }
  if (key) e.key = key;
  entries.set(norm(card), e);
  index();
  save();
}

load();

module.exports = { resolve, cardOf, isHidden, sessionKeyOf, record };
