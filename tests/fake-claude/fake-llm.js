// 검증용 OpenAI 호환 요약 API: /chat/completions 에 고정 요약을 돌려준다(실제 LLM 호출 금지).
"use strict";

const http = require("http");

const PORT = Number(process.env.FAKE_LLM_PORT || 7899);
const TEXT = process.env.FAKE_LLM_TEXT || "- 이전 작업: 가짜 요약입니다.\n- 상태: 이어받기 검증\n- 다음: 계속";

http.createServer((req, res) => {
  if (!/\/chat\/completions$/.test(req.url || "")) { res.writeHead(404); return res.end(); }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: TEXT } }], usage: { total_tokens: 10 } }));
  });
}).listen(PORT, "127.0.0.1", () => console.log("fake llm: " + PORT));
