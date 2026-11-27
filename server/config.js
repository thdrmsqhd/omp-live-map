// 설정: 경로·MIME·셸 경로·argv(--port, --hours)·상수.
"use strict";

const path = require("path");
const os = require("os");

const HOME = os.homedir();
// 검증·데모는 OMP_MAP_SESSIONS·OMP_MAP_CLAUDE_PROJECTS 로 다른 폴더를 가리킬 수 있다(실제 ~/.omp·~/.claude 를 건드리지 않게).
const SESSIONS = process.env.OMP_MAP_SESSIONS || path.join(HOME, ".omp", "agent", "sessions");
const CLAUDE_PROJECTS = process.env.OMP_MAP_CLAUDE_PROJECTS || path.join(HOME, ".claude", "projects"); // Claude Code 세션 기록(<슬러그>/<sessionId>.jsonl). 읽기 전용.
const BLOBS = path.join(HOME, ".omp", "agent", "blobs"); // 세션 이미지 blob:sha256:<hash> 실체
const UPLOADS = path.join(os.tmpdir(), "omp-live-map-uploads"); // 프롬프트 첨부 저장소(신뢰 루트)
const ROOT = path.join(__dirname, "..");
const UI_DIR = path.join(ROOT, "ui");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const BASH = process.env.OMP_MAP_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const PORT = Number(argOf("port", 7800));
const HOURS = Number(argOf("hours", 24));
const ACTIVE_MS = 90_000;
const MSG_KEEP = 120; // 노드당 보존 메시지 수
const MSG_BUDGET = 200_000; // 응답 전체 messages 바이트 상한
const USD_KRW = Number(process.env.OMP_USD_KRW || 1390);

module.exports = { HOME, SESSIONS, CLAUDE_PROJECTS, BLOBS, UPLOADS, ROOT, UI_DIR, MIME, BASH, PORT, HOURS, ACTIVE_MS, MSG_KEEP, MSG_BUDGET, USD_KRW };
