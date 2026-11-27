/* omp-live-map · model · 마지막 턴 활동 범위 계산(DOM·상태 없음) */

const LIVE_RUNNING = /^(running|live|started|spawned|active|pending|queued)$/i;

// 마지막 턴의 항목 범위. 도는 중이면 마지막 turn_end 뒤, 끝났으면 그 턴(turn_end 두 개 사이)이다.
// sub(서브 라이프사이클)·notify(알림)는 안내일 뿐이라 turn_end 뒤에 붙어도 도는 중으로 보지 않는다.
const ACT_WORK = (it) => it.kind !== "sub" && it.kind !== "notify";

function actRange(list) {
  let end = -1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === "turn_end") { end = i; break; }
  const tail = list.slice(end + 1);
  if (tail.some(ACT_WORK)) return { items: tail, running: true };
  if (end < 0) return { items: tail, running: false };
  let prev = -1;
  for (let i = end - 1; i >= 0; i--) if (list[i].kind === "turn_end") { prev = i; break; }
  return { items: list.slice(prev + 1, end), running: false };
}

// 마지막 턴에 보일 활동 항목. 본문 스트림이 없는 서브에이전트는 실시간 text 가 답변이다. 스트림과 겹치면 빼 이중 표시를 막는다.
// hideDoneSubs 면 끝난 서브에이전트 항목은 뺀다.
function actItemsOf(list, st, hideDoneSubs) {
  const { items, running } = actRange(list);
  const showText = running && !(st && st.stream);
  return {
    items: items.filter((it) => (it.kind === "think" || it.kind === "tool" || it.kind === "sub" || it.kind === "notify" || (showText && it.kind === "text"))
      && (it.kind !== "sub" || !hideDoneSubs || !it.status || LIVE_RUNNING.test(it.status))),
    running,
  };
}

if (typeof module !== "undefined") module.exports = { LIVE_RUNNING, ACT_WORK, actRange, actItemsOf };
