// 대화 API: 맵 세션 띄우기·끝내기·목록, 프롬프트 전송(첨부 포함)·취소, 모델 목록·변경, 세션 맥락 요약.
"use strict";

const { json, withJson } = require("./http");
const { newSession, stopSession, prompt, cancel, list } = require("./sessions");
const { listModels, setModel } = require("./session-model");
const { prepare, MAX_BODY: UPLOAD_BODY } = require("./uploads");
const { answer } = require("./ui-requests");
const harness = require("./harness");
const { switchHarness } = require("./harness/switch");
const { summaryOf } = require("./summary");

// 본문 { text, files } 를 보낼 메시지와 images 로 바꾼다. 실패하면 { error }.
const promptOf = (p) => {
  const claude = String(p.harness || "") === "claude" || harness.of(String(p.node || "")) === "claude";
  return prepare(String(p.text || "").trim(), p.files, claude ? "claude" : "");
};

module.exports = {
  "POST /api/session/new": (req, res) => withJson(req, res, async (p) => {
    const a = promptOf(p);
    if (a.error) return json(res, { ok: false, out: a.error });
    json(res, await newSession(String(p.cwd || ""), a.message, a.images, String(p.harness || "omp")));
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
  // 하네스 전환: 원래 세션 요약을 넘겨 대상 하네스로 새 세션을 시작하고 카드 id 는 계보로 유지한다.
  "POST /api/session/switch": (req, res) => withJson(req, res, async (p) => {
    json(res, await switchHarness(String(p.node || ""), String(p.target || "")));
  }),
  "POST /api/summary": (req, res) => withJson(req, res, async (p) => json(res, await summaryOf(String(p.node || "")))),
};
