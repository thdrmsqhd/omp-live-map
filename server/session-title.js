"use strict";

// 세션 제목·첫 지시로 보여 줄 한 줄(순수 함수). 하네스·도구가 사용자 메시지 앞에 끼워 넣는 머리말과 화면 글꼴에 없는 글리프를 걷어 낸다.
//  - 대괄호 시스템 머리말: [OpenClaw: 870 earlier messages …] · [System …] · [Image attached …] · [Thu 2026-11-19 16:13 GMT+9](시각 표시).
//    닫히지 않은 머리말(잘린 줄)은 그 줄 전체를 건너뛴다. 사용자가 쓴 [역할]·[실습 파일] 같은 한국어 머리표는 그대로 둔다.
//  - 시스템 태그 블록: <system-reminder>…</system-reminder>, <command-message>…, <local-command-stdout>… 는 통째로 빼고,
//    <pasted_content …> 같은 감싸는 태그는 태그만 빼 내용을 남긴다. <command-name>/init</command-name> 은 '/init' 으로 남긴다.
//  - 하네스 메타 문단: '⟦openclaw:ctx⟧' 같은 표지가 있는 줄부터 빈 줄까지(Conversation info … json · Conversation context … 지난 대화 목록).
//  - 글리프: 사용자 영역(PUA, Nerd Font 아이콘 U+E000–U+F8FF · U+F0000–U+10FFFF), 대체 문자 U+FFFD, 두부 '□'(U+25A1).
// 의미 있는 줄(글자·숫자가 있는 줄)이 없으면 "" 를 돌려준다 — 부르는 쪽은 다음 사용자 메시지로 넘어간다.

const PREAMBLE = /^(?:openclaw|system|image|images|attached|attachment|file attached|pasted|request interrupted|context|hook|reminder|note|tool|warning|info)\b/i;
const STAMP = /^(?:mon|tue|wed|thu|fri|sat|sun)\w*\s+\d{4}-\d\d-\d\d|^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/i;
const DROP_BLOCKS = /<(system-reminder|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|user-prompt-submit-hook|system-notice)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi;
const GLYPHS = /[\uE000-\uF8FF\uFFFD\u25A1]|[\u{F0000}-\u{10FFFF}]/gu;
const MEANING = /[\p{L}\p{N}]/u;
const META = /⟦[^⟧\n]{1,40}⟧/;

// 줄 앞의 시스템 머리말을 벗긴다. 닫히지 않은 머리말이면 null(그 줄을 건너뛴다).
function stripPreamble(line) {
  let rest = line;
  for (;;) {
    const m = /^\s*\[([^\]\n]*)(\])?\s*/.exec(rest);
    if (!m || !(PREAMBLE.test(m[1].trim()) || STAMP.test(m[1].trim()))) return rest;
    if (!m[2]) return null;
    rest = rest.slice(m[0].length);
  }
}

function sessionTitleText(text, max = 120) {
  let s = String(text ?? "");
  if (!s.trim()) return "";
  s = s.replace(/<command-name>\s*([^<]*?)\s*<\/command-name>/gi, "\n$1\n").replace(DROP_BLOCKS, "\n")
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?>/g, "\n").replace(GLYPHS, "");
  let meta = false;
  for (const raw of s.split(/\r?\n/)) {
    if (META.test(raw)) { meta = true; continue; }
    if (meta) { if (!raw.trim()) meta = false; continue; } // 메타 문단은 빈 줄에서 끝난다
    const line = stripPreamble(raw.trim());
    if (line === null) continue;
    const flat = line.replace(/\s+/g, " ").trim();
    if (MEANING.test(flat)) return flat.slice(0, max);
  }
  return "";
}

module.exports = { sessionTitleText };
