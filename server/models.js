// 모델 설정: models.yml에서 요약용 provider 선택, OpenAI 호환 chat 호출, (provider, model) 컨텍스트 윈도 조회.
"use strict";

const fs = require("fs");
const path = require("path");
const { HOME } = require("./config");

function providerConfig() {
  if (process.env.OMP_LLM_BASE_URL && process.env.OMP_LLM_API_KEY) {
    return { baseUrl: process.env.OMP_LLM_BASE_URL, apiKey: process.env.OMP_LLM_API_KEY,
      model: process.env.OMP_LLM_MODEL || "deepseek-v4.1-flash", name: "env" };
  }
  try {
    const yml = fs.readFileSync(path.join(HOME, ".omp", "agent", "models.yml"), "utf8");
    const blocks = yml.split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/);
    const cands = [];
    for (const b of blocks) {
      const name = (b.match(/^  ([A-Za-z0-9_-]+):/) || [])[1];
      if (!name) continue;
      const baseUrl = (b.match(/baseUrl:\s*(\S+)/) || [])[1];
      const apiKey = (b.match(/apiKey:\s*(\S+)/) || [])[1];
      const model = (b.match(/- id:\s*(\S+)/) || [])[1];
      const headers = {};
      const hm = b.match(/\n\s+headers:\s*\n((?:\s{6,}[^\n]+\n?)+)/);
      if (hm) {
        for (const line of hm[1].split("\n")) {
          const m2 = line.match(/^\s+([A-Za-z0-9-]+):\s*(\S+)/);
          if (m2) headers[m2[1]] = m2[2];
        }
      }
      if (baseUrl && apiKey && model) cands.push({ name, baseUrl, apiKey, model, headers });
    }
    const preferred = ["zen-go", "zen"];
    cands.sort((a, b) => (preferred.indexOf(a.name) + 1 || 99) - (preferred.indexOf(b.name) + 1 || 99));
    return cands[0] || null;
  } catch {
    return null;
  }
}

async function apiChat(prompt, maxTokens = 500, system) {
  const cfg = providerConfig();
  if (!cfg) throw new Error("API provider 없음");
  const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { ...(cfg.headers || {}), "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify({
      model: process.env.OMP_SUMMARY_MODEL || cfg.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system || "You are a precise assistant. Answer in Korean, concisely." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  return msg.content && msg.content.trim() ? msg.content.trim() : String(msg.reasoning_content || "").trim();
}

const MODELS_YML = path.join(HOME, ".omp", "agent", "models.yml");
const MODELS_DB = path.join(HOME, ".omp", "agent", "models.db");
const CTX_TTL_MS = 10 * 60_000;
let ctxTable = null; // { yml, db, ymlAny, dbAny } — key "provider\nid" / id -> contextWindow
let ctxLoadedAt = 0;
let sqlite; // undefined: 아직 시도 안 함, null: 사용 불가

// node:sqlite는 require 시 ExperimentalWarning을 찍는다. 그 require 동안만 걸러낸다.
function loadSqlite() {
  if (sqlite !== undefined) return sqlite;
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const msg = typeof warning === "string" ? warning : warning && warning.message;
    if (/SQLite/.test(String(msg))) return;
    return emit.call(process, warning, ...rest);
  };
  try { sqlite = require("node:sqlite"); } catch { sqlite = null; } finally { process.emitWarning = emit; }
  return sqlite;
}

function readYmlWindows(yml, ymlAny) {
  let text;
  try { text = fs.readFileSync(MODELS_YML, "utf8"); } catch { return; }
  let provider = "", id = "";
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/))) { provider = m[1]; id = ""; }
    else if ((m = line.match(/^\s+- id:\s*["']?([^"'\s]+)/))) id = m[1];
    else if (id && (m = line.match(/^\s+contextWindow:\s*(\d+)/))) {
      yml.set(provider + "\n" + id, Number(m[1]));
      if (!ymlAny.has(id)) ymlAny.set(id, Number(m[1]));
    }
  }
}

function readDbWindows(db, dbAny) {
  const lib = loadSqlite();
  if (!lib || !fs.existsSync(MODELS_DB)) return;
  let conn;
  try {
    conn = new lib.DatabaseSync(MODELS_DB, { readOnly: true });
    // updated_at 오름차순으로 덮어써서 같은 (provider, id)는 최신 행 값이 남는다.
    for (const row of conn.prepare("SELECT provider_id, models FROM model_cache ORDER BY updated_at").all()) {
      let models;
      try { models = JSON.parse(row.models); } catch { continue; }
      if (!Array.isArray(models)) continue;
      for (const x of models) {
        if (!x || !x.id || !(x.contextWindow > 0)) continue;
        const provider = x.provider || String(row.provider_id).split(":")[0];
        db.set(provider + "\n" + x.id, x.contextWindow);
        dbAny.set(x.id, x.contextWindow);
      }
    }
  } catch { /* 읽기 실패는 조용히 0 */ } finally {
    try { if (conn) conn.close(); } catch {}
  }
}

// 1순위 models.yml, 2순위 models.db(같은 키면 updated_at 큰 쪽), provider 불일치 시 같은 id의 아무 값, 없으면 0.
function ctxWindowOf(provider, model) {
  if (!model) return 0;
  if (!ctxTable || Date.now() - ctxLoadedAt > CTX_TTL_MS) {
    const t = { yml: new Map(), db: new Map(), ymlAny: new Map(), dbAny: new Map() };
    readYmlWindows(t.yml, t.ymlAny);
    readDbWindows(t.db, t.dbAny);
    ctxTable = t;
    ctxLoadedAt = Date.now();
  }
  const key = (provider || "") + "\n" + model;
  return ctxTable.yml.get(key) || ctxTable.db.get(key) || ctxTable.ymlAny.get(model) || ctxTable.dbAny.get(model) || 0;
}

module.exports = { providerConfig, apiChat, ctxWindowOf };
