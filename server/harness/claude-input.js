// Claude 실행 입력·질문 변환: stream-json stdin 프레임, AskUserQuestion → 기존 ask UI 요청, 답 → 다음 프롬프트.
// 모듈 상태는 없다(요청·답 모양만 바꾼다).
"use strict";

// 첨부 이미지가 있으면 stream-json 입력 한 줄로 보낸다(텍스트·이미지 content 블록).
function frameOf(text, images, sessionId) {
  const content = [{ type: "text", text: text || "(이미지 첨부)" }];
  for (const img of images || []) {
    if (!img || !img.data) continue;
    content.push({ type: "image", source: { type: "base64", media_type: img.mimeType || "image/png", data: img.data } });
  }
  return JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: sessionId }) + "\n";
}

const optOf = (o) => ({
  label: String((o && o.label) ?? ""),
  description: o && o.description ? String(o.description) : "",
});

// assistant 메시지 content 의 AskUserQuestion tool_use → ui-requests 의 ask 요청 모양(없으면 null).
function askOf(blocks, seen) {
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || b.type !== "tool_use" || b.name !== "AskUserQuestion" || !b.id) continue;
    if (seen && seen.has(b.id)) continue;
    const input = b.input && typeof b.input === "object" ? b.input : {};
    const questions = (Array.isArray(input.questions) ? input.questions : []).map((q, i) => ({
      id: String(q.id ?? i),
      question: String(q.question ?? ""),
      header: q.header ? String(q.header) : "",
      multi: !!(q.multi || q.multiSelect),
      recommended: -1,
      options: (Array.isArray(q.options) ? q.options : []).map(optOf),
    }));
    if (!questions.length) continue;
    if (seen) seen.add(b.id);
    return { id: String(b.id), method: "ask", timeout: 0, questions };
  }
  return null;
}

// ask 응답(answers 배열) → 다음 프롬프트 글. 고른 항목·직접 입력을 그대로 적는다.
function answerText(response, request) {
  const answers = (response && Array.isArray(response.answers)) ? response.answers : [];
  const lines = [];
  answers.forEach((a, i) => {
    const q = request && request.questions ? request.questions[i] : null;
    const picks = (Array.isArray(a && a.selectedOptions) ? a.selectedOptions : []).map(String);
    const custom = a && typeof a.customInput === "string" ? a.customInput.trim() : "";
    const text = [...picks, custom].filter(Boolean).join(", ");
    lines.push((q && q.question ? q.question + " → " : "") + (text || "(선택 없음)"));
  });
  return lines.length ? "질문에 대한 답: " + lines.join(" / ") : "질문에 대한 답: (선택 없음)";
}

module.exports = { frameOf, askOf, answerText };
