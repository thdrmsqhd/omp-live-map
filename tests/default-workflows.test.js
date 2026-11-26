"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { addPresetDefinitions, addPresetWorkflows, buildPreset, listPresets } = require("../server/engineering/workflow-presets");
const { HARNESSES, LOOPS, PRESET_LOOPS } = require("../server/engineering/default-definitions");

async function withProject(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-default-workflows-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", root, "Fixture", "main");
    const catalogues = catalog(db);
    await run({ db, catalogues, workflows: workflowCatalog(db, catalogues) });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("기본 Workflow 8종이 한꺼번에 만들어지고 다시 만들어도 중복되지 않는다", () => withProject(({ db, catalogues, workflows }) => {
  const first = addPresetWorkflows(db, catalogues, workflows, "one");
  assert.deepEqual(first.created.map(({ name }) => name).sort(), listPresets().map(({ name }) => name).sort());
  assert.equal(first.created.length, 8);
  assert.deepEqual(first.skipped, []);
  const second = addPresetWorkflows(db, catalogues, workflows, "one");
  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, 8);
  assert.equal(workflows.list("one").length, 8);
}));

test("템플릿의 단계마다 맞는 하네스·루프가 붙는다", () => withProject(({ db, catalogues, workflows }) => {
  addPresetWorkflows(db, catalogues, workflows, "one");
  const nameOf = (id) => catalogues.versionOf(id).name;
  const roleOf = new Map(Object.values(HARNESSES).map(({ name }, index) => [name, Object.keys(HARNESSES)[index]]));
  for (const preset of listPresets()) {
    const saved = workflows.list("one").find(({ name }) => name === preset.name);
    const { nodes } = workflows.get("one", saved.id).payload;
    for (const node of nodes.filter(({ definition }) => definition)) {
      if (node.type === "loop") {
        assert.equal(nameOf(node.definition), LOOPS[PRESET_LOOPS[preset.id]].name, `${preset.id}: loop`);
        continue;
      }
      const role = roleOf.get(nameOf(node.definition));
      const expected = node.id === "review" ? "reviewer" : node.id === "triage" ? "triage" : "author";
      assert.equal(role, expected, `${preset.id}/${node.id}: harness role`);
    }
    for (const node of nodes.filter(({ type }) => ["agent", "loop"].includes(type))) {
      assert.match(node.instruction, /[가-힣]/, `${preset.id}/${node.id}: Korean instruction`);
      assert.match(node.instruction, /\nOUTPUT FILE: \.workflow-output\/[a-z]+\.md$/, `${preset.id}/${node.id}: output file`);
    }
    for (const node of nodes.filter(({ type }) => type === "approval")) {
      assert.match(node.prompt, /1\. .*\n2\. /, `${preset.id}/${node.id}: checklist prompt`);
    }
  }
}));

test("현장 장애 분석은 빠른 점검 하네스로 먼저 분류하고 그 결과를 보고서 작성에 넘긴다", () => withProject(({ db, catalogues, workflows }) => {
  const refs = addPresetDefinitions(db, catalogues, null);
  const graph = buildPreset("incident", refs);
  assert.deepEqual(graph.nodes.map(({ id }) => id), ["start", "triage", "draft", "final-approval", "end"]);
  const [triage, draft] = [graph.nodes[1], graph.nodes[2]];
  assert.equal(triage.definition, refs.triage);
  assert.equal(draft.definition, refs.author);
  assert.deepEqual(draft.inputs, [{ name: "triage", source: "triage", artifact: "triage" }]);
  assert.ok(workflows.save({ project: "one", payload: graph }).id);
  // 점검 하네스를 고르지 않은 요청은 설계 및 문서 하네스로 대신한다.
  assert.equal(buildPreset("incident", { author: "a", triage: "" }).nodes[1].definition, "a");
}));

test("화면이 처음 고를 기본 정의 이름이 실제 기본 정의와 일치한다", () => withProject(({ db, catalogues }) => {
  addPresetDefinitions(db, catalogues, null);
  const names = new Set(catalogues.definitions(null, "personal").map(({ name }) => name));
  for (const preset of listPresets()) {
    for (const [role, name] of Object.entries(preset.suggest)) {
      if (!preset[role] || !name) continue;
      assert.ok(names.has(name), `${preset.id}: ${role} suggestion "${name}" is not a default definition`);
    }
    assert.equal(Boolean(preset.suggest.loop), preset.loop, `${preset.id}: loop suggestion`);
  }
}));
