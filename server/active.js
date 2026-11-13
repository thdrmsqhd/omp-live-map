// TUI 세션 실시간 방송: 기록 파싱이 모아 둔 이벤트를 짧은 주기로 SSE 로 내보낸다.
// 맵이 띄운 rpc 세션은 server/live.js 가 프레임에서 직접 방송하므로 여기서는 건너뛴다.
"use strict";

const { allStates } = require("./tail");
const { pushLive } = require("./sse");
const { has } = require("./sessions");

const TICK = 800; // 기록은 파일 쓰기 때 이미 0.3초 안에 읽히므로, 이 주기는 방송만 묶는 시간이다.

let timer = null;

// 파일 상태 하나의 이벤트 큐를 비워 방송한다.
function flush(st) {
  if (!st.liveq || !st.liveq.length) return;
  // 맵 rpc 세션은 프레임이 원천이지만, 어떤 툴이 잡을 띄웠는지는 기록에서만 알 수 있다.
  if (has(st.file)) {
    const keep = st.liveq.filter((ev) => ev.kind === "tool_job");
    st.liveq.length = 0;
    for (const ev of keep) pushLive({ node: st.file, ...ev });
    return;
  }
  const batch = st.liveq.splice(0, st.liveq.length);
  for (const ev of batch) pushLive({ node: st.file, ...ev });
}

function tick() {
  for (const st of allStates()) flush(st);
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK);
  timer.unref?.();
}

module.exports = { start, tick };
