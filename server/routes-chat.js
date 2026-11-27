// 대화 API: 맵 세션 띄우기·끝내기·목록, 프롬프트 전송(첨부 포함)·취소, 모델 목록·변경, 세션 맥락 요약.
"use strict";

const { json, withJson } = require("./edge/http");
const { newSession, stopSession, prompt, cancel, list } = require("./sessions");
const { listModels, setModel, modelOptions } = require("./session-model");
const { prepare, MAX_BODY: UPLOAD_BODY } = require("./uploads");
const { answer } = require("./ui-requests");
const harness = require("./harness");
const sessionHarness = require("./harness/session-harness");
const { switchHarness } = require("./harness/switch");
const { summaryOf } = require("./summary");

// 본문 { text, files } 를 보낼 메시지와 images 로 바꾼다. 실패하면 { error }.
const promptOf = (p) => {
  const claude = String(p.harness || "") === "claude" || harness.of(String(p.node || "")) === "claude";
  return prepare(String(p.text || "").trim(), p.files, claude ? "claude" : "");
};

const ccSettings=require("./harness/claude-settings");
const ccRun=require("./harness/claude-run");
const ccInfo=require("./harness/claude-project-info");
const lineage=require("./lineage");
function snapshotNode(id){return require("./snapshot").snapshot().sessions.flatMap(s=>s.nodes).find(n=>n.id===id);}
function ccNode(p){const n=String(p.node||"");return n&&harness.of(lineage.resolve(n))==="claude"?n:null;}
module.exports = {
  "POST /api/chat/diff":(req,res)=>withJson(req,res,async p=>{const n=snapshotNode(String(p.node||""));if(!n?.cwd)return json(res,{ok:false,out:"세션 작업 폴더 없음"});return json(res,await require("./chat-diff").diff(n.cwd,String(p.file||"")));}),
  "POST /api/chat/activity":(req,res)=>withJson(req,res,p=>{const node=String(p.node||"");if(!node)return json(res,{ok:false,out:"세션 필요"});return json(res,{ok:true,turns:require("./sse").activityHistory(lineage.cardOf(node)||node)});}),
  "POST /api/claude/queue":(req,res)=>withJson(req,res,p=>{const n=ccNode(p);if(!n)return json(res,{ok:false,out:"Claude 세션 필요"});if(p.action==="enqueue"){const a=prepare(String(p.text||"").trim(),p.files,"claude");if(a.error||!a.message)return json(res,{ok:false,out:a.error||"빈 지시"});return json(res,ccRun.enqueue(n,a.message,a.images));}if(p.action==="list")return json(res,{ok:true,...ccRun.queueView(n)});return json(res,ccRun.queueChange(n,p.action,p.id,p.text));},UPLOAD_BODY),
  "POST /api/claude/project-info":(req,res)=>withJson(req,res,p=>{const n=ccNode(p);if(!n)return json(res,{ok:false,out:"Claude 세션 필요"});const loc=ccRun.locate(n);if(!loc.exists&&!loc.known)return json(res,{ok:false,out:"세션 기록 없음"});return json(res,{ok:true,cwd:loc.cwd,sources:ccInfo.inspect(loc.cwd)});}),
  "GET /api/claude/status": async(req,res)=>json(res,await ccSettings.status()),
  "POST /api/claude/options": (req,res)=>withJson(req,res,async p=>{const node=ccNode(p);if(!node)return json(res,{ok:false,out:"세션 필요"});if(p.options){if(ccRun.isBusy(node))return json(res,{ok:false,out:"실행 중에는 변경할 수 없습니다"});const status=await ccSettings.status();if(p.options.protocol==="stream"&&!status.stream)return json(res,{ok:false,out:"설치 CLI의 양방향 권한 프로토콜 미확인"});if(p.options.effort!=="default"&&!status.effort)return json(res,{ok:false,out:"설치 CLI에서 effort 미확인"});return json(res,ccSettings.set(node,p.options));}json(res,{ok:true,options:ccSettings.get(node),diagnostics:ccRun.diagnostics(node),maxRuns:ccRun.maxRuns});}),
  // ＋ 세션 창의 하네스 목록(Engineering 하네스 정의). 고른 하네스의 역할·지시가 세션의 시스템 프롬프트가 된다.
  "GET /api/session-harnesses": (req, res) => {
    try { json(res, { ok: true, harnesses: sessionHarness.list() }); }
    catch (error) { json(res, { ok: false, out: error.message }); }
  },
  "GET /api/session/model-options": async (req, res, url) => json(res, await modelOptions(url.searchParams.get("omp") === "1")),
  "POST /api/session/new": (req, res) => withJson(req, res, async (p) => {
    try {
      // p.harness 는 실행기(omp·claude), p.definition 은 고른 하네스 정의 { id, version }.
      const chosen = p.definition != null ? sessionHarness.resolve(p.definition) : undefined;
      const kind = chosen?.adapter ?? String(p.harness || "omp");
      const a = promptOf({ ...p, harness: kind });
      if (a.error) return json(res, { ok: false, out: a.error });
      return json(res, await newSession(String(p.cwd || ""), a.message, a.images, kind, chosen));
    } catch (error) {
      return json(res, { ok: false, out: error.message });
    }
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
