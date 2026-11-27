/* 관제 Workflow 상세 패널의 실행 제어와 결과 전달. 예전 Engineering 'Workflow' 폼 화면에만 있던 기능이다.
   - 실행 제어: 일시정지·재개·취소(workflow-runs/action)
   - 결과 전달(성공한 실행, 원격이 있는 Git 작업 폴더): 변경 승인(브랜치) → GitHub PR → CI 확인 → 릴리스 후보 승인 → 테스트·스테이징 배포
   실행은 고른 작업 폴더에서 바로 하므로 결과는 이미 그 폴더에 있다(따로 반영하는 단계가 없다). */
let wfRunControlsSignature;
// 요청이 끝난 뒤 패널이 다시 그려져도 성공 문구가 남도록 다음 status 초기값으로 쓴다.
let wfRunControlsNotice = "";
function paintWorkflowRunControls() {
  const frame = $("wf-map-run-controls");
  const detail = wfMap.run;
  if (!detail || wfMap.edit) { frame.replaceChildren(); wfRunControlsSignature = ""; return; }
  const { run, delivery, staging } = detail;
  const signature = JSON.stringify([run.id, run.status, run.workspace, delivery, staging, detail.nodes.some(({ status }) => status === "interrupted")]);
  if (signature === wfRunControlsSignature) return;
  // 브랜치 입력 중이면 다시 그리지 않는다.
  if (frame.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  wfRunControlsSignature = signature;
  const status = wfText("p", wfRunControlsNotice, "wf-run-controls-status");
  wfRunControlsNotice = "";
  status.setAttribute("role", "status");
  const act = (label, endpoint, extra, enabled, confirmText, done) => {
    const button = wfActionButton(label, async ({ currentTarget }) => {
      if (confirmText && !window.confirm(confirmText)) return;
      currentTarget.disabled = true;
      status.textContent = "";
      try {
        const result = await mapWorkflowRequest(endpoint, {}, { id: run.id, ...extra() });
        if (done) wfRunControlsNotice = done(result);
        wfRunControlsSignature = "";
        void refreshWorkflowQueue();
        const next = await mapWorkflowRequest("workflow-run", { id: run.id });
        if (wfMap.run?.run.id === run.id) wfAccept(next, false);
      } catch (error) { status.textContent = error.message; currentTarget.disabled = false; }
    });
    button.disabled = !enabled;
    return button;
  };
  const controls = wfText("div", "", "wf-actions");
  controls.append(
    act("일시정지", "workflow-runs/action", () => ({ operation: "pause" }), run.status === "running"),
    act("재개", "workflow-runs/action", () => ({ operation: "resume" }),
      ["paused", "interrupted"].includes(run.status) && !detail.nodes.some(({ status }) => status === "interrupted")),
    act("실행 취소", "workflow-runs/action", () => ({ operation: "cancel" }),
      ["queued", "running", "paused", "waiting_approval", "interrupted"].includes(run.status), "이 실행을 취소할까요? 진행 중인 단계도 멈춥니다."));
  const parts = [controls];
  if (run.status === "succeeded" && run.workspace) {
    parts.push(wfText("p", "실행 결과는 이미 작업 폴더(" + run.workspace + ")에 있습니다."));
    const box = document.createElement("details");
    box.open = Boolean(delivery);
    box.append(wfText("summary", "결과 전달 · GitHub PR·CI·배포"),
      wfText("p", "원격(origin)이 있는 Git 폴더에서만 씁니다. 작업 폴더에서 변경을 커밋하고 브랜치를 푸시한 뒤 승인합니다."));
    if (!delivery || delivery.state === "approved") {
      const branch = document.createElement("input");
      branch.value = delivery?.head ?? "";
      branch.placeholder = "작업 브랜치 이름(비우면 자동)";
      branch.setAttribute("aria-label", "작업 브랜치 이름");
      box.append(wfText("label", "변경을 커밋할 브랜치"), branch, act(delivery ? "브랜치 다시 승인" : "변경 승인", "workflow-delivery/approve", () => ({ branch: branch.value }), true));
    }
    const steps = wfText("div", "", "wf-actions");
    steps.append(
      act("GitHub PR 생성 또는 연결", "workflow-delivery/pr", () => ({}), Boolean(delivery) && delivery.state !== "created"),
      act("CI 확인", "workflow-delivery/ci", () => ({}), Boolean(delivery?.pr_number)),
      act("릴리스 후보 승인", "workflow-delivery/release", () => ({}), delivery?.ci_status === "passed"));
    box.append(steps);
    if (delivery) box.append(wfText("p", [delivery.sha, delivery.pr_url, delivery.ci_status && "CI " + delivery.ci_status,
      delivery.release_approved && "릴리스 후보 승인됨"].filter(Boolean).join(" · ")));
    if (delivery?.release_approved) {
      const environment = document.createElement("select");
      environment.append(new Option("test", "test"), new Option("staging", "staging"));
      environment.setAttribute("aria-label", "배포 환경");
      if (staging) { environment.value = staging.environment; environment.disabled = true; }
      box.append(environment, act(staging ? "테스트 배포 상태 확인" : "테스트 배포 승인 및 요청", "workflow-delivery/staging", () => ({ environment: environment.value }), true));
      if (staging) box.append(wfText("p", [staging.environment, staging.state, staging.conclusion, staging.url].filter(Boolean).join(" · ")));
    }
    parts.push(box);
  }
  frame.replaceChildren(...parts, status);
}
