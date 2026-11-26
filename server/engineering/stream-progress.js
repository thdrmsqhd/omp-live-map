"use strict";

// Claude Code stream-json 이벤트를 관제 화면용 진행 조각으로 바꾼다.
// 일반 응답 글자뿐 아니라, 도구 호출(▸ Read src/a.js)과 Write·Edit 가 파일에 쓰는 본문도 만들어지는 대로 흘려 보낸다.
// (리뷰·문서 단계는 결과를 대부분 파일에 쓰므로, 이것이 없으면 실행 중 화면에 흐르는 글자가 거의 없다.)
const targetFields = ["file_path", "path", "pattern", "command", "notebook_path"];
const bodyFields = ["content", "new_string"];

// 아직 끝나지 않은 JSON 문자열 값을 앞부분만 풀어 읽는다(마지막 이스케이프가 잘렸으면 그 앞까지만).
function partialString(json, field) {
  const match = json.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)`));
  if (!match) return null;
  let raw = match[1];
  for (let cut = 0; cut < 6; cut++) {
    try { return { text: JSON.parse('"' + raw + '"'), done: match[2] === '"' }; } catch { raw = raw.slice(0, -1); }
  }
  return null;
}

function claudeStreamProgress(progress) {
  let tool = null;
  return (event) => {
    if (event?.type !== "stream_event") return;
    const inner = event.event;
    if (inner?.type === "content_block_start") {
      const block = inner.content_block;
      if (block?.type === "tool_use" && typeof block.name === "string") {
        tool = { name: block.name, json: "", target: false, body: {} };
        progress({ phase: "tool", tool: block.name, text: "\n▸ " + block.name });
      } else tool = null;
      if (block?.type === "thinking") progress({ phase: "thinking" });
      return;
    }
    if (inner?.type === "content_block_stop") {
      if (tool) progress({ text: "\n" });
      tool = null;
      return;
    }
    if (inner?.type !== "content_block_delta") return;
    const delta = inner.delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string") progress({ phase: "responding", text: delta.text });
    else if (delta?.type === "thinking_delta") progress({ phase: "thinking" });
    else if (delta?.type === "input_json_delta" && tool && typeof delta.partial_json === "string") {
      tool.json = (tool.json + delta.partial_json).slice(-200000);
      if (!tool.target) {
        for (const field of targetFields) {
          const value = partialString(tool.json, field);
          if (value?.done) {
            tool.target = true;
            progress({ text: " " + value.text.replace(/^\/workspace\//, "").slice(0, 160) + "\n" });
            break;
          }
        }
      }
      for (const field of bodyFields) {
        const value = partialString(tool.json, field);
        if (!value) continue;
        const shown = tool.body[field] ?? 0;
        if (value.text.length > shown) {
          if (!tool.target && !shown) { tool.target = true; progress({ text: "\n" }); }
          progress({ phase: "writing", text: value.text.slice(shown) });
          tool.body[field] = value.text.length;
        }
      }
    }
  };
}

// OMP RPC 의 도구 시작 이벤트를 한 줄 요약으로 만든다.
function ompToolLine(frame) {
  const args = frame.args && typeof frame.args === "object" ? frame.args : {};
  const target = targetFields.map((field) => args[field]).find((value) => typeof value === "string") ?? "";
  return "\n▸ " + frame.toolName + (target ? " " + target.replace(/^\/workspace\//, "").slice(0, 160) : "") + "\n";
}

module.exports = { claudeStreamProgress, ompToolLine, partialString };
