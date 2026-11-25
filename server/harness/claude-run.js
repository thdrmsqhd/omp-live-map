// Claude Code 실행 어댑터: `claude -p`(비대화 stream-json) 한 번을 한 턴으로 띄우고, 출력 조각을 chat·live 로
// 방송한다. 이어가기는 --resume, 비우기는 계보(lineage)로 카드 id 를 유지한 새 세션, 첨부는 stream-json 입력,
// ask 는 AskUserQuestion tool_use → 기존 질문 UI → 답을 다음 프롬프트로. 등록 상태는 runs 하나뿐이다.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pushChat, pushLive } = require("../sse");
const { killTree } = require("../rpc");
const lineage = require("../lineage");
const uiAsk = require("../ui-requests");
const claude = require("./claude");
const model = require("./claude-model");
const input = require("./claude-input");
const settings=require("./claude-settings");
const {createQueue}=require("./claude-queue");
const {transport}=require("./claude-stream");

const runs = new Map(); // 낮춘 카드 경로 -> { node, child, busy, cancelled, full, streamed, answer, seen }
const cwds = new Map(); // 낮춘 카드 경로 -> 작업 폴더(방금 만든 세션은 기록 스캔 전에도 필요)
const norm = (p) => {const v=path.normalize(String(p || ""));return process.platform==="win32"?v.toLowerCase():v;};
const MAX_RUNS=Math.max(1,Math.min(32,Number(process.env.OMP_MAP_CLAUDE_MAX_RUNS)||4));
const MAX_FRAME=8*1024*1024;
const diagnostics=new Map();
const redact=s=>String(s||"").replace(/(?:sk-ant-|Bearer\s+)[A-Za-z0-9._-]+/gi,"[redacted]").slice(-4096);
function recordDiagnostic(s,code){diagnostics.set(norm(s.node),{state:s.state,code,stderr:redact(s.stderr),at:Date.now()});if(diagnostics.size>200)diagnostics.delete(diagnostics.keys().next().value);}
function removeRun(s){const k=norm(s.node);if(runs.get(k)===s)runs.delete(k);}
const errText = (e) => String((e && e.message) || e);

function finish(s, code) {
  if (!s.busy) return;
  const cancelled = s.cancelled;
  s.busy = false;
  s.state=cancelled?"cancelled":code?"failed":"completed";recordDiagnostic(s,code);
  pushLive({node:s.node,kind:"turn_end",ts:Date.now()});
  pushChat({ node: s.node, kind: "done", text: s.full, error:code?redact(s.stderr):undefined, code: cancelled ? 130 : code, ...(cancelled ? { cancelled: true } : {}) });
  s.full = "";
}

function emitText(s, text) {
  if (!text) return;
  s.full = (s.full + text).slice(-4000);
  pushChat({ node: s.node, kind: "delta", text });
  pushLive({ node: s.node, kind: "text", text });
}

// 카드 → 지금 실제 파일·세션 id·작업 폴더. 비우기 직후면 아직 파일이 없고 pending 이 있다.
function locate(card) {
  const file = lineage.resolve(card);
  const pend = claude.pendingOf(card);
  const st = claude.stateOf(file) || claude.stateOf(card);
  const exists = fs.existsSync(file);
  const known = pend || cwds.get(norm(card)) || "";
  return { card, file, pend, st, exists, known,
    sessionId: path.basename(file, ".jsonl"),
    cwd: (pend && pend.cwd) || cwds.get(norm(card)) || (st && st.cwd && fs.existsSync(st.cwd) ? st.cwd : process.cwd()) };
}

// stdout 한 줄: 부분 메시지·완성 메시지·결과. AskUserQuestion 이 보이면 질문 카드를 띄운다.
function onFrame(s, o) {
  const ev = o.event;
  if (o.type === "stream_event" && ev) {
    const d = ev.delta;
    if (ev.type === "content_block_delta" && d) {
      if (d.type === "text_delta") { s.streamed = true; emitText(s, d.text); }
      else if (d.type === "thinking_delta" && d.thinking) pushLive({ node: s.node, kind: "think", text: d.thinking });
    }
    if(ev.type==="content_block_start"&&ev.content_block?.type==="tool_use"){const t=ev.content_block;pushLive({node:s.node,kind:"tool",id:t.id,name:t.name,args:""});}
    return;
  }
  if(o.type==="user"){for(const t of o.message?.content||[])if(t.type==="tool_result"){pushLive({node:s.node,kind:"tool_end",id:t.tool_use_id,error:!!t.is_error});}return;}
  if (o.type === "assistant") {
    const blocks = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];
    const ask = input.askOf(blocks, s.seen);
    if (ask) uiAsk.ask(s.node, ask, (response) => answerAsk(s.node, input.answerText(response, ask)));
    if (!s.streamed) emitText(s, blocks.filter((b) => b && b.type === "text").map((b) => b.text).join(""));
    return;
  }
  if (o.type === "result") {
    if (!s.streamed && typeof o.result === "string") emitText(s, o.result);
    s.resultCode=o.is_error?1:0;s.state="finishing";
  }
}

function spawnTurn(s, loc, text, images, fresh) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", settings.get(s.node).permission];
  if (fresh) args.push("--session-id", loc.sessionId);
  else args.push("--resume", loc.sessionId);
  if (images && images.length) args.push("--input-format", "stream-json");
  const m = model.modelOf(s.node) || model.modelOf(loc.card) || model.modelOf(loc.file) || model.DEFAULT_MODEL;
  if(m!=="default")args.push("--model", m);
  const effort=settings.get(s.node).effort;if(effort!=="default")args.push("--effort",effort);
  const child = spawn("claude", args, { cwd: loc.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  s.child = child;
  s.busy = true;s.state="running";s.stderr="";
  s.cancelled = false;
  s.full = "";
  s.streamed = false;
  let buf = "";
  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      if(buf.length>MAX_FRAME&&!buf.includes("\n")){s.stderr+="\nstdout frame exceeds limit";s.state="failed";killTree(child);return;}
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        try { onFrame(s, o); } catch (e) {s.stderr=redact(s.stderr+"\n"+errText(e));}
      }
    });
  }
  if (child.stderr) {child.stderr.setEncoding("utf8");child.stderr.on("data",d=>{s.stderr=redact(s.stderr+d);});}
  if (child.stdin) child.stdin.on("error", () => {});
  child.on("error", (err) => {
    pushChat({ node: s.node, kind: "done", text: "claude 실행 실패: " + err.message, code: 127 });
    s.stderr=redact(s.stderr+"\n"+err.message);s.state="failed";s.busy=false;recordDiagnostic(s,127);removeRun(s);
  });
  child.on("close", (code) => {
    const answer = s.answer;
    s.answer = "";
    if(buf.trim().startsWith("{"))try{onFrame(s,JSON.parse(buf));}catch{}
    finish(s, answer ? 0 : (s.resultCode??(code===null?1:code)));
    removeRun(s);
    if (answer&&!s.cancelled) setTimeout(() => startTurn(s.node, answer, []), 0);
    else queue.done(s.node,!s.cancelled&&(s.resultCode??code)===0);
  });
  try {
    child.stdin.write(images && images.length ? input.frameOf(text, images, loc.sessionId) : text);
    child.stdin.end();
  } catch (e) {
    pushChat({ node: s.node, kind: "done", text: errText(e), code: 1 });
    s.stderr=redact(errText(e));finish(s,1);killTree(child);
  }
}

// 카드에 한 턴을 보낸다. 파일이 없고 pending/방금 만든 세션이면 새 session-id 로 시작한다.
function streamTurn(s,text,images){
 s.busy=true;s.state="running";s.cancelled=false;s.full="";s.streamed=false;s.resultCode=undefined;s.seen=new Set();clearTimeout(s.idleTimer);
 pushChat({node:s.node,kind:"req",text});
 if(!s.transport.write(JSON.parse(input.frameOf(text,images,s.sessionId)))){finish(s,1);killTree(s.child);return {ok:false,out:"CLI stream closed"};}
 return {ok:true,node:s.node};
}
function spawnStream(s,loc,text,images){
 const opt=settings.get(s.node),args=["-p","--input-format","stream-json","--output-format","stream-json","--verbose","--include-partial-messages","--permission-prompt-tool","stdio","--permission-mode",opt.permission];
 args.push(loc.exists?"--resume":"--session-id",loc.sessionId);const m=model.modelOf(s.node)||model.DEFAULT_MODEL;if(m!=="default")args.push("--model",m);if(opt.effort!=="default")args.push("--effort",opt.effort);
 const child=spawn("claude",args,{cwd:loc.cwd,windowsHide:true,stdio:["pipe","pipe","pipe"]});s.child=child;s.sessionId=loc.sessionId;s.stderr="";s.state="starting";s.optionsSignature=JSON.stringify([opt,model.modelOf(s.node)||model.DEFAULT_MODEL]);
 child.stderr?.setEncoding("utf8");child.stderr?.on("data",d=>{s.stderr=redact(s.stderr+d);});
 s.transport=transport(child,{
 frame:o=>{if(o.type==="assistant"){const blocks=o.message?.content||[];if(!s.streamed)emitText(s,blocks.filter(b=>b.type==="text").map(b=>b.text).join(""));return;}
 if(o.type==="result"){if(!s.busy)return;if(!s.streamed&&typeof o.result==="string")emitText(s,o.result);finish(s,o.is_error?1:0);s.state="idle";uiAsk.drop(s.node);queue.done(s.node,!o.is_error&&!s.cancelled);if(!s.busy){s.state="idle";s.idleTimer=setTimeout(()=>{if(!s.busy){s.state="closing";s.transport.close();setTimeout(()=>{if(!s.transport.ended)killTree(child);},3000).unref();}},60000);s.idleTimer.unref();}return;}onFrame(s,o);},
 permission:(id,r,respond)=>{s.state="waiting_approval";const tool=r.tool_name||"Tool";const q=input.askOf([{type:"tool_use",name:tool,id,input:r.input}],new Set());
 if(q){uiAsk.ask(s.node,q,answer=>{if(answer?.cancelled||answer?.timedOut){respond({behavior:"deny",message:"User cancelled"});s.state="running";return {ok:true};}const answers={};for(const [i,a] of (answer?.answers||[]).entries()){const question=q.questions[i]?.question;if(question)answers[question]=[...(a.selectedOptions||[]),a.customInput].filter(Boolean).join(", ");}if(Object.keys(answers).length!==q.questions.length){respond({behavior:"deny",message:"Incomplete answers"});}else respond({behavior:"allow",updatedInput:{...r.input,answers}});s.state="running";return {ok:true};});return;}
 uiAsk.ask(s.node,{id,method:"confirm",title:"Claude 도구 승인: "+tool,message:JSON.stringify(r.input||{}).slice(0,4000)},answer=>{s.state="running";const allow=answer?.confirmed===true&&!answer.cancelled;return {ok:respond(allow?{behavior:"allow",updatedInput:r.input||{}}:{behavior:"deny",message:"User denied"})};});},
 error:e=>{s.stderr=redact(s.stderr+"\n"+errText(e));if(s.busy)finish(s,1);s.state="closing";queue.done(s.node,false);uiAsk.drop(s.node);killTree(child);},
 closed:(code)=>{clearTimeout(s.idleTimer);uiAsk.drop(s.node);const wasBusy=s.busy;if(wasBusy)finish(s,code||1);removeRun(s);if(wasBusy)queue.done(s.node,false);}
 });return streamTurn(s,text,images);
}
function startTurn(card, text, images) {
  const existing=runs.get(norm(card));
  if(existing?.transport&&!existing.busy&&existing.state==="idle"){const signature=JSON.stringify([settings.get(card),model.modelOf(card)||model.DEFAULT_MODEL]);if(signature!==existing.optionsSignature||existing.sessionId!==locate(card).sessionId){clearTimeout(existing.idleTimer);existing.state="closing";existing.transport.close();setTimeout(()=>{if(!existing.transport.ended)killTree(existing.child);},3000).unref();return {ok:false,out:"실행 설정이 변경되어 기존 프로세스를 정리 중입니다. 잠시 후 다시 보내세요."};}return streamTurn(existing,text,images);}
  if(existing)return {ok:false,out:"이전 실행이 아직 정리되지 않았습니다"};
  if(runs.size>=MAX_RUNS)return {ok:false,out:"Claude 동시 실행 제한 "+MAX_RUNS+"개"};
  const loc = locate(card);
  if (!loc.exists && !loc.known) return { ok: false, out: "Claude 세션 기록 없음" };
  const s = { node: card, seen: new Set() };
  runs.set(norm(card), s);
  if(settings.get(card).protocol==="stream"){try{return spawnStream(s,loc,text,images);}catch(e){removeRun(s);return {ok:false,out:errText(e)};}}
  pushChat({ node: card, kind: "req", text });
  spawnTurn(s, loc, text, images, !loc.exists);
  return { ok: true, node: card };
}

const busyRun = (card) => { const s = runs.get(norm(card)); return s && s.busy ? s : null; };

const queue=createQueue({start:startTurn,busy:card=>{const s=runs.get(norm(card));return !!s&&(!s.transport||s.busy||s.state!=="idle"&&s.state!=="completed");}});
function queueCard(node){return lineage.cardOf(node)||node;}
function prompt(node, text, images) {
  const card = lineage.cardOf(node) || node;
  if (busyRun(card)) return { ok: false, out: "이미 응답을 생성하고 있습니다" };
  return startTurn(card, text, images);
}

// 질문 답: 도는 턴이 있으면 그 턴을 끊고(질문에 답할 수 없는 -p 모드) 끝난 뒤 다음 프롬프트로 잇는다.
function answerAsk(card, text) {
  const s = runs.get(norm(card));
  if (s && s.busy) {
    s.answer = text;
    s.cancelled = false;
    if (s.child) killTree(s.child);
    return { ok: true };
  }
  return startTurn(card, text, []);
}

function newSession(cwd, text, images) {
  const dir = cwd || process.env.USERPROFILE || "";
  let stat = null;
  try { stat = fs.statSync(dir); } catch { /* 없음 */ }
  // 파일 경로를 작업 폴더로 받으면 claude 는 띄우지도 못한다. 카드만 남기지 말고 바로 실패한다.
  if (!stat || !stat.isDirectory()) return { ok: false, out: "폴더 없음: " + dir };
  if (!String(text || "").trim() && !(images && images.length)) return { ok: false, out: "Claude Code 세션은 첫 지시가 필요합니다" };
  const id = crypto.randomUUID();
  const file = claude.fileFor(dir, id);
  cwds.set(norm(file), dir);
  return startTurn(file, text, images);
}

// 하네스 전환 뒤 카드 id 로도 같은 작업 폴더·도는 턴을 쓰게 한다(resume 은 cwd 로 프로젝트를 찾는다).
function bind(card, cwd, file) {
  if (card && cwd) cwds.set(norm(card), cwd);
  const s = file && runs.get(norm(file));
  if (s) {
    runs.delete(norm(file)); s.node = card; runs.set(norm(card), s);
  }
}

function cancel(node) {
  const s = runs.get(norm(node));
  if (!s || !s.busy) return { ok: false, out: "실행 중인 프롬프트 없음" };
  s.cancelled = true;s.state="cancelling";s.answer="";queue.change(s.node,"pause");
  if(s.transport){void s.transport.control({subtype:"interrupt"}).catch(()=>killTree(s.child));setTimeout(()=>{if(s.busy&&s.cancelled)killTree(s.child);},5000).unref();return {ok:true};}
  if (s.child) killTree(s.child);
  setTimeout(() => { if (s.busy && s.cancelled) finish(s, 130); }, 3000).unref();
  return { ok: true };
}

function stop(node) {
  const key = norm(lineage.cardOf(node) || node);
  const s = runs.get(key);
  if (!s) return { ok: false, out: "맵이 띄운 세션이 아닙니다" };
  if (s.busy) s.cancelled = true;
  s.state="stopping";s.answer="";clearTimeout(s.idleTimer);uiAsk.drop(s.node);queue.change(s.node,"pause");
  if (s.child) killTree(s.child);
  return { ok: true };
}

function list() {
  return [...runs.values()].map((s) => ({ node: s.node, file: s.node, harness: "claude", pid: s.child ? s.child.pid : 0, busy: !!s.busy, state:s.state }));
}

module.exports = { newSession, prompt, cancel, stop, list, bind, isBusy: (card) => {const s=runs.get(norm(card));return !!s&&(!s.transport||s.busy||s.state!=="idle");}, diagnostics:(card)=>diagnostics.get(norm(card))||null, maxRuns:MAX_RUNS, enqueue:(node,text,images)=>queue.enqueue(queueCard(node),text,images), queueView:node=>queue.view(queueCard(node)), queueChange:(node,action,id,text)=>queue.change(queueCard(node),action,id,text), locate };
