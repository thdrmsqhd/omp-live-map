// 세션 컨텍스트 보기·편집: 기록에서 지금 유효한 컨텍스트를 읽고, omp 가 실제로 지원하는 방법으로만 고친다.
// 지원되는 편집 = (a) 작업 가이드를 프롬프트/steer 로 보내기, (b) compact + customInstructions 지시문.
// omp rpc 에는 메시지 삭제·수정·시스템 프롬프트 교체 명령이 없다(JSONL 직접 수정은 하지 않는다).
"use strict";

const { readContext, compactInstructions, safeFile } = require("./context");
const { acquire, prompt, list } = require("./sessions");

const COMPACT_MS = 300000; // 압축은 요약 모델 호출이 끝나야 응답이 온다
const errText = (e) => String((e && e.message) || e);

// 노드 하나의 지금 컨텍스트. 기록을 읽기만 하므로 어떤 세션이든 볼 수 있다.
function view(node) {
  const file = safeFile(node);
  if (!file) return { ok: false, out: "세션 기록 경로가 아닙니다" };
  let data;
  try { data = readContext(file); } catch (e) { return { ok: false, out: "기록 읽기 실패: " + errText(e) }; }
  return {
    ok: true, node: file,
    items: data.items, count: data.items.length, totalTokens: data.totalTokens,
    owned: list().some((s) => s.node === file), // 맵이 띄운 프로세스가 쥐고 있는지(= 압축 편집 가능)
  };
}

// (a) 작업 가이드: 프롬프트로 보낸다. 에이전트가 도는 중이면 omp 가 steer 로 끼워 넣는다.
async function guide(node, text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, out: "작업 가이드가 비었습니다" };
  const r = await prompt(node, t);
  return r.ok ? { ...r, mode: "guide" } : r;
}

// (b) 압축: 남길 항목을 고르고 가이드를 지시문으로 넘긴다. 고른 항목은 "요약에서 빼라"로 들어간다.
async function compact(node, text, omit) {
  const { s, err } = await acquire(node);
  if (err) return err;
  let data;
  try { data = readContext(safeFile(node)); } catch (e) { return { ok: false, out: "기록 읽기 실패: " + errText(e) }; }
  const instructions = compactInstructions(text, omit, data.items);
  const cmd = { type: "compact" };
  if (instructions) cmd.customInstructions = instructions;
  try {
    const r = await s.rpc.send(cmd, { timeoutMs: COMPACT_MS });
    if (!r.success) throw new Error(r.error || "omp 가 압축을 받지 않았습니다");
    return { ok: true, mode: "compact", out: "압축했습니다", result: r.data || null };
  } catch (e) {
    return { ok: false, out: errText(e) };
  }
}

module.exports = { view, guide, compact };
