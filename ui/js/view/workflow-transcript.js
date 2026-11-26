/* 관제 Workflow: 단계의 '작업 지시 수행 내역'을 크게 본다.
   - 상세 패널(#workflow-inspector)은 왼쪽 가장자리를 끌어 넓힐 수 있고 폭을 기억한다.
   - '전체 기록'은 단계 한 번 실행의 출력·도구 호출·시도 구분을 화면 대부분을 쓰는 창에 보여 준다(실행 중이면 1.5초마다 이어 받는다).
   서버 workflow-transcript(server/engineering/workflow-live.js)는 실행 중 기록과 끝난 실행 기록(최근 10개)을 돌려준다. */
const WF_INSPECTOR_WIDTH = "omp-workflow-inspector-width";
const wfTranscript = { run: null, node: null, timer: 0, index: 0, signature: "" };

function wfInspectorWidth(width) {
  const stage = $("stage").getBoundingClientRect().width || innerWidth;
  const value = Math.round(Math.min(Math.max(300, width), Math.max(320, stage * 0.72)));
  $("workflow-inspector").style.width = value + "px";
  return value;
}
{
  const saved = Number(readJSON(WF_INSPECTOR_WIDTH, 0));
  if (saved) wfInspectorWidth(saved);
  const grip = document.createElement("div");
  grip.id = "wf-inspector-grip";
  grip.title = "끌어서 상세 패널 폭 조절 · 두 번 누르면 넓게/기본";
  $("workflow-inspector").prepend(grip);
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const right = $("workflow-inspector").getBoundingClientRect().right;
    const move = (next) => wfInspectorWidth(right - next.clientX);
    const stop = () => {
      grip.removeEventListener("pointermove", move);
      writeJSON(WF_INSPECTOR_WIDTH, $("workflow-inspector").offsetWidth);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("lostpointercapture", stop, { once: true });
  });
  grip.addEventListener("dblclick", () => {
    const wide = $("workflow-inspector").offsetWidth < 600;
    writeJSON(WF_INSPECTOR_WIDTH, wfInspectorWidth(wide ? 760 : 440));
  });
}

// '전체 기록' 버튼. 에이전트·루프·명령 단계에서만 의미가 있다.
function wfTranscriptButton(node) {
  if (!node || !["agent", "loop", "command"].includes(node.type)) return null;
  const button = wfText("button", "전체 기록 보기", "wf-transcript-open");
  button.type = "button";
  button.onclick = () => void openWorkflowTranscript(wfMap.run.run.id, node.id);
  return button;
}

async function openWorkflowTranscript(run, node) {
  const dialog = $("wf-transcript");
  wfTranscript.run = run;
  wfTranscript.node = node;
  wfTranscript.index = 0;
  wfTranscript.signature = "";
  const label = wfNodes().find(({ id }) => id === node)?.label ?? node;
  $("wf-transcript-title").textContent = label + " · 작업 지시 수행 내역";
  $("wf-transcript-text").textContent = "기록을 불러오는 중입니다.";
  if (!dialog.open) dialog.showModal();
  await refreshWorkflowTranscript(true);
}

async function refreshWorkflowTranscript(first = false) {
  clearTimeout(wfTranscript.timer);
  const dialog = $("wf-transcript");
  if (!dialog.open || !wfTranscript.run) return;
  const { run, node } = wfTranscript;
  let data;
  try { data = await mapWorkflowRequest("workflow-transcript", { id: run, node }); }
  catch (error) { $("wf-transcript-text").textContent = error.message; return; }
  if (run !== wfTranscript.run || node !== wfTranscript.node) return;
  const entries = data.entries ?? [];
  const picker = $("wf-transcript-entry");
  const options = entries.map((entry, index) => (index === 0 && data.running ? "지금 실행 중 · " : "") +
    new Date(entry.startedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    (entry.endedAt ? " · " + wfClock(entry.endedAt - entry.startedAt) : ""));
  if (picker.options.length !== options.length || [...picker.options].some((option, index) => option.text !== options[index])) {
    picker.replaceChildren(...options.map((text, index) => new Option(text, String(index))));
    picker.value = String(Math.min(wfTranscript.index, Math.max(0, options.length - 1)));
  }
  picker.hidden = options.length < 2;
  const entry = entries[Number(picker.value) || 0];
  const text = $("wf-transcript-text");
  if (!entry) {
    text.textContent = "아직 남은 기록이 없습니다. 에이전트·루프·명령 단계가 실행되면 출력과 도구 호출이 여기에 쌓입니다.";
    $("wf-transcript-meta").textContent = "";
    $("wf-transcript-tools").replaceChildren();
  } else {
    const signature = entry.startedAt + ":" + entry.text.length + ":" + entry.tools.length + ":" + entry.endedAt;
    if (signature !== wfTranscript.signature) {
      wfTranscript.signature = signature;
      const nearBottom = first || text.scrollHeight - text.scrollTop - text.clientHeight < 40;
      text.textContent = entry.text || "(출력 없음)";
      if (nearBottom) text.scrollTop = text.scrollHeight;
      $("wf-transcript-meta").textContent = [
        entry.endedAt ? "끝남" : "실행 중",
        entry.attempts > 1 ? "시도 " + Math.max(1, entry.attempt) + "/" + entry.attempts : "",
        entry.text.length.toLocaleString("ko-KR") + "자",
        entry.dropped ? "가운데 " + entry.dropped.toLocaleString("ko-KR") + "자 생략" : "",
        "도구 " + entry.tools.length + "회",
      ].filter(Boolean).join(" · ");
      $("wf-transcript-tools").replaceChildren(...entry.tools.slice(-60).map(({ at, name }) => {
        const chip = wfText("span", name);
        chip.title = "시작 후 " + wfClock(at);
        return chip;
      }));
    }
  }
  if (data.running && (Number(picker.value) || 0) === 0) wfTranscript.timer = setTimeout(() => void refreshWorkflowTranscript(), 1500);
}

$("wf-transcript-entry").onchange = () => {
  wfTranscript.index = Number($("wf-transcript-entry").value) || 0;
  wfTranscript.signature = "";
  void refreshWorkflowTranscript(true);
};
$("wf-transcript-close").onclick = () => $("wf-transcript").close();
$("wf-transcript").addEventListener("close", () => { clearTimeout(wfTranscript.timer); wfTranscript.run = null; });
