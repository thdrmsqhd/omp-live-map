/* model · Workflow 요약: Task 칸반의 Workflow 칩(title)이 단계마다 어떤 하네스·Loop 가 도는지 한 줄씩 보여 준다. */

// 고른 하네스는 역할과 모델, Loop 는 반복할 하네스·최대 시도·검증 명령을 한 줄로 요약한다.
function workflowRoleSummary(id, definitions) {
  const item = id ? definitions.find((entry) => entry.id === id) : null;
  if (!item) return "";
  const nameOf = (target) => definitions.find((entry) => entry.id === target)?.name;
  const payload = item.payload ?? {};
  if (item.kind === "harness") return `역할 ${payload.role} · ${nameOf(payload.model) ? "모델 " + nameOf(payload.model) : "모델 연결 안 됨"}`;
  if (item.kind !== "loop") return "";
  const check = payload.checks?.[0];
  const verify = check ? "검증 " + [check.command, ...(check.args ?? [])].join(" ") : "검증 명령 없음";
  return `${nameOf(payload.harness) ? "하네스 " + nameOf(payload.harness) : "하네스 연결 안 됨"} · 최대 ${payload.attempts}회 · ${verify}`;
}

// 저장된 Workflow 의 하네스·Loop 단계가 무엇으로 도는지 단계마다 한 줄로 적는다.
function workflowStepSummaries(payload, definitions) {
  return (payload?.nodes ?? []).filter((node) => node.type === "agent" || node.type === "loop").map((node) => {
    const item = node.definition ? definitions.find((entry) => entry.id === node.definition) : null;
    if (item) return `${node.label} → ${item.kind === "loop" ? "루프" : "하네스"} ${item.name} (${workflowRoleSummary(item.id, definitions)})`;
    return `${node.label} → 연결 안 됨`;
  });
}
