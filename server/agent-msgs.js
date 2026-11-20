// 서브에이전트 호출·결과 파서. omp 기록의 `task` 툴 호출(arguments.tasks[]), `write agent://이름` 후속 지시,
// 결과 안내문(<task-result id agent status duration><output>…)을 대화 블록용 구조로 바꾼다.
"use strict";

const CALL_MAX = 8;       // 한 턴에 싣는 호출 카드 수
const TASK_MAX = 3000;    // 호출 카드 작업 내용 글자 수
const OUTPUT_MAX = 8000;  // 결과 본문 글자 수(기록 메시지 상한과 같다)

const clip = (s, n) => String(s || "").replace(/\r\n?/g, "\n").trim().slice(0, n);

// 툴 호출 하나 → 호출 카드 목록. 서브에이전트와 무관한 툴이면 빈 배열.
function callsOf(name, a) {
  if (!a || typeof a !== "object") return [];
  if (name === "task" && Array.isArray(a.tasks)) {
    return a.tasks.slice(0, CALL_MAX).filter((t) => t && typeof t === "object").map((t) => ({
      k: "task", name: clip(t.name, 60), agent: clip(t.agent || "task", 40), task: clip(t.task, TASK_MAX),
    }));
  }
  const m = name === "write" && typeof a.path === "string" && /^agent:\/\/([^/?#]+)/.exec(a.path);
  return m ? [{ k: "send", to: m[1], task: clip(a.content, TASK_MAX) }] : [];
}

// 안내문 하나에 든 <task-result> 들 → [{ id, agent, status, duration, text }]
function resultsOf(text) {
  const out = [];
  const re = /<task-result\s+([^>]*)>([\s\S]*?)<\/task-result>/g;
  for (let m; (m = re.exec(String(text || ""))); ) {
    const attr = {};
    for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) attr[x[1]] = x[2];
    const body = /<output>\n?([\s\S]*?)\n?<\/output>/.exec(m[2]);
    out.push({ id: attr.id || "", agent: attr.agent || "", status: attr.status || "", duration: attr.duration || "", text: clip(body ? body[1] : m[2], OUTPUT_MAX) });
  }
  return out;
}

module.exports = { callsOf, resultsOf, CALL_MAX };
