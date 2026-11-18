// Claude 비우기 대상(새 세션 시작 전) 기록: 카드 → 다음 세션 파일. 기록 스캔 전에도 카드를 빈 상태로 그린다.
"use strict";

const fs = require("fs");
const path = require("path");
const norm = (p) => path.normalize(String(p || "")).toLowerCase();

const pending = new Map(); // 카드 경로(낮춤) -> { card, file, cwd, title, key, at }

function begin({ card, file, cwd, title, key }) {
  if (!card || !file) return;
  pending.delete(norm(file));
  pending.set(norm(card), { card, file, cwd: cwd || "", title: title || "", key: key || "", at: Date.now() });
}

function of(card) {
  const p = pending.get(norm(card));
  return p && !fs.existsSync(p.file) ? p : null;
}

function list() {
  return [...pending.values()].filter((p) => !fs.existsSync(p.file));
}

module.exports = { begin, of, list };
