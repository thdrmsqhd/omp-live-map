"use strict";

const { problem } = require("./state");
const { transaction } = require("../infrastructure/sqlite");
const { MODELS, HARNESSES, LOOPS, PRESET_LOOPS, assetsOf } = require("./default-definitions");

function addPresetDefinitions(db, catalog, project) {
  return transaction(db, () => {
    const scope = project ? "project" : "personal";
    const existing = catalog.definitions(project, scope);
    if (project && catalog.project(project).archived) throw problem(409, "보관된 프로젝트에는 기본 구성을 추가할 수 없습니다.");
    const ensure = (kind, payload) => existing.find((entry) => entry.kind === kind && entry.name === payload.name)
      ?? catalog.writeDefinition({ scope, project, kind, payload });
    const models = Object.fromEntries(Object.entries(MODELS).map(([key, payload]) => [key, ensure("model", payload)]));
    const harnesses = Object.fromEntries(Object.entries(HARNESSES).map(([key, spec]) => {
      const assets = assetsOf(spec);
      return [key, ensure("harness", { name: spec.name, adapter: "claude", model: models[spec.model].id, role: spec.role,
        instructions: spec.instructions, ...(assets ? { assets } : {}) })];
    }));
    const loops = Object.fromEntries(Object.entries(LOOPS).map(([key, { harness, ...payload }]) =>
      [key, ensure("loop", { ...payload, harness: harnesses[harness].id })]));
    // loop 는 기본값, loops 는 템플릿마다 처음 고를 루프(신규 기능·버그 수정·리팩토링·테스트 작성). 화면에서 바꿔 고를 수 있다.
    return { author: harnesses.author.id, reviewer: harnesses.reviewer.id, triage: harnesses.triage.id, loop: loops.feature.id,
      loops: Object.fromEntries(Object.entries(PRESET_LOOPS).map(([preset, key]) => [preset, loops[key].id])) };
  });
}

// 기본 제공 Workflow 템플릿. 단계마다 어떤 하네스(역할)가 맡는지 정해 두고, 노드 지시문은 그 하네스의 역할과 이어지게 쓴다.
//   plan·draft → 설계 및 문서(author), review → 코드 리뷰(reviewer), triage → 빠른 점검(triage), implement → 루프(loop)
const DESIGN_PROMPT = "계획과 인수 기준을 검토해 주세요.\n"
  + "1. 요구사항이 빠짐없이 담겼는지\n2. 인수 기준이 검증 가능한지\n3. 변경 범위와 위험을 받아들일 수 있는지";
const FINAL_PROMPT = "검증 결과와 산출물을 확인해 주세요.\n"
  + "1. 검증 명령과 리뷰 결과가 통과했는지\n2. 지적 사항이 처리됐는지\n3. 남은 위험을 받아들일 수 있는지";
const DOCS_PROMPT = "산출물을 확인해 주세요.\n1. 저장소에서 확인한 사실만 담겼는지\n2. '미확인'으로 표시된 내용을 어떻게 처리할지";

const presets = Object.freeze({
  feature: {
    name: "신규 기능 개발", summary: "계획 → 승인 → 구현·검증 → 리뷰", phases: ["plan", "designApproval", "implement", "review", "finalApproval"],
    labels: { plan: "요구사항 및 계획" },
    text: {
      plan: "요구사항과 제약을 정리하고, 검증 가능한 인수 기준과 변경 계획(파일·순서·위험·되돌리는 방법)을 작성한다.",
      implement: "승인된 계획과 인수 기준만 구현하고 테스트를 추가한다. 검증 명령이 모두 통과해야 끝난다.",
      review: "승인된 계획과 인수 기준에 비춰 실제 변경과 테스트 증거를 검토하고 지적 사항을 보고한다.",
    },
  },
  bugfix: {
    name: "버그 수정", summary: "원인 찾기 → 승인 → 재현 테스트로 수정 → 리뷰", phases: ["plan", "designApproval", "implement", "review", "finalApproval"],
    labels: { plan: "재현·원인 가설" },
    text: {
      plan: "증상을 재현하는 절차와 원인 가설, 수정 범위, 인수 기준(수정 전에는 실패하고 수정 후에는 통과)을 작성한다.",
      implement: "재현 테스트를 먼저 추가해 실패를 확인하고, 근본 원인을 고쳐 통과시킨다. 증상만 가리는 수정은 하지 않는다.",
      review: "근본 원인을 고쳤는지, 증상만 가린 수정은 아닌지, 재현 테스트가 수정 전에 실패했는지 검토한다.",
    },
  },
  refactor: {
    name: "리팩토링", summary: "동작은 그대로 두고 구조를 정리", phases: ["plan", "designApproval", "implement", "review", "finalApproval"],
    labels: { plan: "구조 개선 계획" },
    text: {
      plan: "개선할 구조, 바꾸지 않을 외부 동작, 단계별 계획과 각 단계의 검증 방법을 작성한다.",
      implement: "외부 동작을 바꾸지 않고 승인된 구조 개선만 단계별로 수행한다. 테스트를 고쳐야 통과한다면 멈추고 이유를 보고한다.",
      review: "동작이 같다는 근거와 범위 밖 변경이 없는지 검토한다.",
    },
  },
  review: {
    name: "코드 리뷰", summary: "코드를 읽고 문제점을 보고서로 정리", phases: ["review", "finalApproval"],
    text: { review: "지정된 변경을 읽기 전용으로 검토하고 지적 사항을 보고한다. 구현 파일은 수정하지 않는다." },
  },
  tests: {
    name: "테스트 작성", summary: "빠진 테스트를 찾아 추가하고 통과 확인", phases: ["plan", "designApproval", "implement", "review", "finalApproval"],
    labels: { plan: "테스트 계획" },
    text: {
      plan: "테스트할 동작과 우선순위(경계값·실패 경로·회귀)를 정하고 인수 기준을 작성한다.",
      implement: "운영 코드를 수정하지 않고 승인된 계획의 테스트를 추가한다. 버그를 발견하면 고치지 말고 재현 테스트와 함께 보고한다.",
      review: "추가한 테스트가 실제 위험을 막는지, 항상 통과하는 테스트는 없는지 검토한다.",
    },
  },
  docs: {
    name: "기술 문서 작성", summary: "코드를 확인해 기술 문서 초안 작성", phases: ["draft", "finalApproval"], finalPrompt: DOCS_PROMPT,
    text: { draft: "저장소에서 실제 동작을 확인한 뒤 대상 독자에 맞는 기술 문서 초안을 작성한다. 확인하지 못한 내용은 '미확인'으로 표시한다." },
  },
  release: {
    name: "릴리스 및 배포", summary: "테스트 실행 뒤 릴리스 노트 작성", phases: ["checks", "draft", "finalApproval"],
    labels: { draft: "릴리스 노트 작성" },
    text: { draft: "변경 요약, 검증 결과, 롤백 방법, 배포 때 주의할 점을 릴리스 노트로 정리한다. 배포 자체는 이 Workflow 밖에서 한다." },
  },
  incident: {
    name: "현장 장애 분석", summary: "증상을 분류하고 원인 분석 보고서 작성", phases: ["triage", "draft", "finalApproval"],
    labels: { triage: "관측 분류", draft: "원인 분석 보고" },
    text: {
      triage: "제공된 관측 내용을 증상·시간·영향 범위로 분류하고 불확실한 부분을 표시한다. 현장 시스템과 운영 데이터는 변경하지 않는다.",
      draft: "분류 결과와 저장소의 읽기 전용 근거로 원인 가설, 확신도, 다음 조치를 보고서로 정리한다. 현장 시스템과 운영 데이터는 변경하지 않는다.",
    },
  },
});

function buildPreset(key, refs = {}) {
  if (typeof key !== "string" || !Object.hasOwn(presets, key)) throw problem(400, "Unknown workflow preset");
  const preset = presets[key];
  const report = (name) => ({ name, path: ".workflow-output/" + name + ".md" });
  const agent = (id, label, definition, work, name) => {
    const output = report(name);
    return { id, label, type: "agent", definition, instruction: work + "\nOUTPUT FILE: " + output.path, outputs: [output] };
  };
  const label = (phase, fallback) => preset.labels?.[phase] ?? fallback;
  const needs = (source, artifact) => ({ name: artifact, source, artifact });
  const lastReport = preset.phases.includes("review") ? needs("review", "review") : needs("draft", "report");
  // 점검 하네스를 따로 고르지 않은 요청(이전 화면·API)은 설계 및 문서 하네스로 대신한다.
  const triage = refs.triage || refs.author;
  const steps = {
    plan: agent("plan", label("plan", "요구사항 및 계획"), refs.author, preset.text.plan ?? "", "plan"),
    designApproval: { id: "design-approval", label: "설계 승인", type: "approval", prompt: DESIGN_PROMPT, inputs: [needs("plan", "plan")] },
    implement: { id: "implementation", label: "작업 및 검증", type: "loop", definition: refs.loop,
      instruction: (preset.text.implement ?? "") + "\nOUTPUT FILE: .workflow-output/implementation.md",
      inputs: [needs("plan", "plan")], outputs: [report("implementation")] },
    review: { ...agent("review", "코드 리뷰", refs.reviewer, preset.text.review ?? "", "review"),
      inputs: preset.phases.includes("implement") ? [needs("implementation", "implementation")] : [] },
    checks: { id: "checks", label: "릴리스 검증", type: "command", check: { command: "node", args: ["--test"], code: 0 } },
    triage: agent("triage", label("triage", "관측 분류"), triage, preset.text.triage ?? "", "triage"),
    draft: { ...agent("draft", label("draft", "산출물 작성"), refs.author, preset.text.draft ?? "", "report"),
      inputs: preset.phases.includes("triage") ? [needs("triage", "triage")] : [] },
    finalApproval: { id: "final-approval", label: "최종 승인", type: "approval", prompt: preset.finalPrompt ?? FINAL_PROMPT, inputs: [lastReport] },
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

// suggest: 화면이 처음 고를 기본 정의의 이름(개인 범위 기본 구성). 템플릿마다 맞는 루프가 다르다.
const suggestFor = (id, preset) => ({
  author: HARNESSES.author.name, reviewer: HARNESSES.reviewer.name, triage: HARNESSES.triage.name,
  loop: PRESET_LOOPS[id] ? LOOPS[PRESET_LOOPS[id]].name : null,
});

const listPresets = () => Object.entries(presets).map(([id, preset]) => ({ id, name: preset.name, summary: preset.summary,
  author: preset.phases.includes("draft") || preset.phases.includes("plan"),
  reviewer: preset.phases.includes("review"), triage: preset.phases.includes("triage"), loop: preset.phases.includes("implement"),
  suggest: suggestFor(id, preset) }));

// 개인 기본 구성으로 기본 제공 Workflow 를 프로젝트에 한꺼번에 만든다. 같은 이름의 Workflow 는 건드리지 않는다.
function addPresetWorkflows(db, catalog, workflows, project) {
  const refs = addPresetDefinitions(db, catalog, null);
  const existing = new Set(workflows.list(project).map(({ name }) => name));
  const created = [], skipped = [];
  for (const { id, name } of listPresets()) {
    if (existing.has(name)) { skipped.push(name); continue; }
    const payload = buildPreset(id, { author: refs.author, reviewer: refs.reviewer, triage: refs.triage, loop: refs.loops[id] ?? refs.loop });
    created.push(workflows.save({ project, payload }));
  }
  return { created, skipped };
}

module.exports = { addPresetDefinitions, addPresetWorkflows, buildPreset, listPresets };
