// HTTP 진입: 요청 가드, 라우트 표 조회, 스냅샷/SSE 엔드포인트, ui/ 정적 파일.
"use strict";

const fs = require("fs");
const path = require("path");
const { UI_DIR, MIME } = require("./config");
const { json, fail, guardStatus } = require("./edge/http");
const { snapshot } = require("./snapshot");
const { outsFor } = require("./live");
const { asksFor } = require("./ui-requests");
const { recentFor } = require("./ext-live");
const { addClient, removeClient, replay } = require("./sse");
const localfs = require("./routes-localfs");
const images = require("./routes-images");
const { prefix, createEngineeringRoutes } = require("./edge/engineering-routes");
const { injectOpsToken } = require("./edge/ops-token");
const { runtime } = require("./engineering/runtime");
const engineeringRuntime = process.env.OMP_MAP_ENGINEERING_DATA
  ? runtime(process.env.OMP_MAP_ENGINEERING_DATA, process.env.ANTHROPIC_API_KEY) : undefined;
if (process.connected && engineeringRuntime) {
  process.on("message", (message) => {
    if (message?.type === "desktop-runtime-key") engineeringRuntime.setKey(message.key);
    if (message?.type === "desktop-shutdown") engineeringRuntime.shutdown();
  });
}
const engineering = createEngineeringRoutes({
  token: process.env.OMP_MAP_ENGINEERING_TOKEN,
  directory: process.env.OMP_MAP_ENGINEERING_DATA,
  runner: engineeringRuntime,
});
delete process.env.OMP_MAP_ENGINEERING_TOKEN;

const ROUTES = {
  ...require("./routes-ops"),
  ...require("./routes-chat"),
  ...require("./routes-context"),
  ...require("./routes-editor"),
  ...localfs.routes,
  "GET /api/performance": (req,res)=>json(res,{...require("./performance").read(),sse:require("./sse").metrics(),desktop:require("./performance").desktopMetrics(),sessions:require("./sessions").list().map(({node,pid,busy,state,harness})=>({node,pid,busy,state,harness,resources:require("./proc").resFor(node)}))}),
  "* /api/graph": (req, res) => json(res, snapshot()),
  "* /api/events": (req, res, url) => {
    const graphVersion = url.searchParams.get("graph") === "2" ? 2 : 1;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    const data = snapshot();
    res.write(`data: ${JSON.stringify(graphVersion === 2 ? { ...data, graphRevision: 0 } : data)}\n\n`);
    if(req.headers["last-event-id"]&&replay(res,req.headers["last-event-id"])){if(!res.destroyed)addClient(res,graphVersion);req.on("close",()=>removeClient(res));return;}
    // 이미 지나간 출력도 붙자마자 보이게 한다(맵 rpc 세션의 툴 출력).
    for (const s of data.sessions) {
      for (const n of s.nodes) {
        const file = n.file || n.id; // 실시간 기록은 지금 실제 파일로 색인된다
        for (const out of outsFor(file)) {
          if (out.name) res.write(`data: ${JSON.stringify({ live: { node: n.id, kind: "tool", id: out.id, name: out.name, args: out.args } })}\n\n`);
          res.write(`data: ${JSON.stringify({ live: { node: n.id, kind: "out", id: out.id, text: out.text } })}\n\n`);
        }
        // 확장(실시간 기록)이 흘려보낸 최근 활동도 되살린다.
        for (const ev of recentFor(file)) res.write(`data: ${JSON.stringify({ live: { ...ev, node: n.id } })}\n\n`);
        // 아직 답하지 않은 질문도 화면이 되살릴 수 있게 함께 보낸다.
        for (const request of asksFor(file)) res.write(`data: ${JSON.stringify({ ask: { node: n.id, kind: "add", request } })}\n\n`);
      }
    }
    // 도는 잡의 툴은 "잡 띄움" 한 줄로 접는다(출력은 잡 카드만 보여준다).
    for (const s2 of data.sessions) {
      for (const j of s2.jobs || []) {
        if (!j.done && j.toolCallId) res.write(`data: ${JSON.stringify({ live: { node: j.file, kind: "tool_job", id: j.toolCallId, job: j.id } })}\n\n`);
      }
    }
    addClient(res,graphVersion);
    req.on("close", () => removeClient(res));
  },
};

const SHELLS = { workflow: "workflow.html", "session-map": "session-map.html", settings: "settings.html" };
const SHARED_SCRIPTS = {
  "js/harness-kinds.js": path.join(__dirname, "engineering", "harness-kinds.js"),
};

function composeIndex() {
  const shell = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");
  return injectOpsToken(shell.replace(/<!-- shell:([a-z-]+) -->/g, (_, name) => {
    const file = SHELLS[name];
    return file ? fs.readFileSync(path.join(UI_DIR, "shell", file), "utf8").trimEnd() : "";
  }));
}

function serveStatic(res, pathname) {
  let rel;
  try {
    rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return fail(res, 400, "bad path");
  }
  if (rel === "index.html") {
    const buf = Buffer.from(composeIndex());
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    return res.end(buf);
  }
  const shared = SHARED_SCRIPTS[rel];
  const file = shared || path.resolve(UI_DIR, rel);
  if (!shared && !file.startsWith(UI_DIR + path.sep)) return fail(res, 403, "forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) return fail(res, 404, "not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
}

async function handle(req, res) {
  const denied = guardStatus(req);
  if (denied) return fail(res, denied, denied === 415 ? "unsupported media type" : "forbidden");
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname.startsWith(prefix)) return engineering(req, res, url);
  const route = ROUTES[req.method + " " + url.pathname] || ROUTES["* " + url.pathname];
  if (route) return route(req, res, url);
  if (url.pathname.startsWith(localfs.PREFIX)) return localfs.serveLocal(req, res, url);
  if (url.pathname.startsWith(images.PREFIX)) return images.serve(req, res, url);
  if (req.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
  fail(res, 404, "not found");
}

module.exports = { handle };
