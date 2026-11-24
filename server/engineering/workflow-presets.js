"use strict";

const { problem } = require("./state");

const presets = Object.freeze({
  feature: { name: "신규 기능 개발", work: "Implement the approved feature and its tests.", phases: ["plan", "designApproval", "implement", "review", "finalApproval"] },
  bugfix: { name: "버그 수정", work: "Reproduce the reported bug and add a targeted regression test with the fix.", phases: ["plan", "designApproval", "implement", "review", "finalApproval"] },
  refactor: { name: "리팩토링", work: "Preserve external behavior while improving the structure described in the approved plan.", phases: ["plan", "designApproval", "implement", "review", "finalApproval"] },
  review: { name: "코드 리뷰", work: "Review the existing change. Report findings without editing implementation files.", phases: ["review", "finalApproval"] },
  tests: { name: "테스트 작성", work: "Add tests covering the specified behavior and edge cases. Leave unrelated production code unchanged.", phases: ["plan", "designApproval", "implement", "review", "finalApproval"] },
  docs: { name: "기술 문서 작성", work: "Verify existing behavior from the repository and draft documentation for the specified audience.", phases: ["draft", "finalApproval"] },
  release: { name: "릴리스 및 배포", work: "Summarize changes, validation status, rollback and rollout considerations. Keep deployment outside this workflow.", phases: ["checks", "draft", "finalApproval"] },
  incident: { name: "현장 장애 분석", work: "Use the supplied incident observations and read-only repository evidence. Describe causes, confidence, and next steps. Do not change field systems or production data.", phases: ["draft", "finalApproval"] },
});

function buildPreset(key, refs = {}) {
  if (typeof key !== "string" || !Object.hasOwn(presets, key)) throw problem(400, "Unknown workflow preset");
  const preset = presets[key];
  const report = (name) => ({ name, path: ".workflow-output/" + name + ".md" });
  const agent = (id, label, definition, work, name) => {
    const output = report(name);
    return { id, label, type: "agent", definition, instruction: work + "\nOUTPUT FILE: " + output.path, outputs: [output] };
  };
  const needs = (source, artifact) => ({ name: artifact, source, artifact });
  const lastReport = preset.phases.includes("review") ? needs("review", "review") : needs("draft", "report");
  const steps = {
    plan: agent("plan", "요구사항 및 계획", refs.author, "Identify requirements, constraints and testable acceptance criteria.", "plan"),
    designApproval: { id: "design-approval", label: "설계 승인", type: "approval", prompt: "계획과 인수 기준을 검토해 주세요.",
      inputs: [needs("plan", "plan")] },
    implement: { id: "implementation", label: "작업 및 검증", type: "loop", definition: refs.loop,
      instruction: preset.work + "\nOUTPUT FILE: .workflow-output/implementation.md",
      inputs: [needs("plan", "plan")], outputs: [report("implementation")] },
    review: { ...agent("review", "코드 리뷰", refs.reviewer, preset.phases.includes("implement")
      ? "Review the actual code changes and test evidence against the approved plan. Report findings." : preset.work, "review"),
      inputs: preset.phases.includes("implement") ? [needs("implementation", "implementation")] : [] },
    checks: { id: "checks", label: "릴리스 검증", type: "command", check: { command: "node", args: ["--test"], code: 0 } },
    draft: agent("draft", "산출물 작성", refs.author, preset.work, "report"),
    finalApproval: { id: "final-approval", label: "최종 승인", type: "approval", prompt: "검증 결과와 산출물의 최종 내용을 확인해 주세요.",
      inputs: [lastReport] },
  };
  if (preset.phases.includes("implement") && refs.author === refs.reviewer) throw problem(400, "Select distinct author and reviewer harnesses");
  const nodes = [{ id: "start", label: "Start", type: "start" },
    ...preset.phases.map((phase) => steps[phase]), { id: "end", label: "End", type: "end" }]
    .map((node, index) => ({ ...node, x: 35 + index * 160, y: 90 }));
  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id, to: node.id, port: nodes[index].type === "approval" ? "approved" : "next",
  }));
  return { name: preset.name, nodes, edges };
}

const listPresets = () => Object.entries(presets).map(([id, preset]) => ({ id, name: preset.name,
  author: preset.phases.includes("draft") || preset.phases.includes("plan"),
  reviewer: preset.phases.includes("review"), loop: preset.phases.includes("implement") }));

module.exports = { buildPreset, listPresets };
