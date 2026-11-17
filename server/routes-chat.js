// 대화 API: 맵 세션 띄우기·끝내기·목록, 프롬프트 전송(첨부 포함)·취소, 모델 목록·변경, 세션 맥락 요약.
"use strict";

const { json, withJson } = require("./http");
const { stateOf } = require("./tail");
const lineage = require("./lineage");
const { newSession, stopSession, prompt, cancel, list } = require("./sessions");
const { apiChat } = require("./models");
const { listModels, setModel } = require("./session-model");
const { prepare, MAX_BODY: UPLOAD_BODY } = require("./uploads");
const { answer } = require("./ui-requests");

// 본문 { text, files } 를 omp 에 보낼 메시지와 images 로 바꾼다. 실패하면 { error }.
const promptOf = (p) => prepare(String(p.text || "").trim(), p.files);

module.exports = {
  "POST /api/session/new": (req, res) => withJson(req, res, async (p) => {
    const a = promptOf(p);
    if (a.error) return json(res, { ok: false, out: a.error });
    json(res, await newSession(String(p.cwd || ""), a.message, a.images));
  }, UPLOAD_BODY),
  "POST /api/session/stop": (req, res) => withJson(req, res, (p) => json(res, stopSession(String(p.node || "")))),
  "* /api/session/list": (req, res) => json(res, { sessions: list() }),
  "POST /api/prompt": (req, res) => withJson(req, res, async (p) => {
    const a = promptOf(p);
    if (a.error) return json(res, { ok: false, out: a.error });
    if (!a.message) return json(res, { ok: false, out: "빈 프롬프트" });
    json(res, await prompt(String(p.node || ""), a.message, a.images));
  }, UPLOAD_BODY),
  "POST /api/session/models": (req, res) => withJson(req, res, async (p) => json(res, await listModels(String(p.node || "")))),
  "POST /api/session/model": (req, res) => withJson(req, res, async (p) => {
    json(res, await setModel(String(p.node || ""), String(p.provider || ""), String(p.id || "")));
  }),
  "POST /api/prompt/cancel": (req, res) => withJson(req, res, async (p) => json(res, await cancel(String(p.node || "")))),
  // 확장 UI 질문(ask·select·confirm·input·editor)에 답한다. 없는 id·이미 해소된 id 는 409.
  "POST /api/chat/answer": (req, res) => withJson(req, res, (p) => {
    const out = answer(String(p.node || ""), String(p.id || ""), p.response);
    if (out.ok) return json(res, out);
    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(out));
  }),
  "POST /api/summary": (req, res) => withJson(req, res, async (p) => {
    const st = stateOf(lineage.resolve(String(p.node || "")));
    if (!st) return json(res, { ok: false, out: "세션 기록 없음" });
    const convo = (st.messages || []).slice(-10).map((m) => (m.role === "user" ? "사용자: " : "에이전트: ") + m.text).join("\n");
    const ctx = st.ctx ? `context ${st.ctx.promptTokens} tokens, 압축 ${st.ctx.compactionEpoch}회` : "context 정보 없음";
    try {
      const text = await apiChat(
        `아래 세션 대화를 보고, 에이전트가 지금 무엇을 이해하고 어떤 상태인지 한국어 3줄로 요약하라. 각 줄은 60자 이내.\n\n[${ctx}]\n${convo || "(대화 없음)"}`,
        700,
        "You summarize coding-session context. Reply in Korean with exactly 3 short bullet lines, no preamble."
      );
      json(res, { ok: true, out: text });
    } catch (e) {
      json(res, { ok: false, out: String(e.message || e) });
    }
  }),
};
