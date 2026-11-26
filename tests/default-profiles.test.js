"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 프로필 저장소는 첫 사용 때 OMP_MAP_STATE 를 읽으므로 모듈을 불러오기 전에 임시 폴더로 돌린다.
const state = fs.mkdtempSync(path.join(os.tmpdir(), "omp-profiles-"));
process.env.OMP_MAP_STATE = state;
const profiles = require("../server/harness/session-profiles");
const { openDatabase } = require("../server/infrastructure/sqlite");
const { catalog } = require("../server/engineering/catalog");
const { workflowCatalog } = require("../server/engineering/workflow-catalog");
const { addPresetDefinitions, ensureProfiles } = require("../server/engineering/workflow-presets");
const { HARNESSES, LOOPS, MODELS, PROFILES } = require("../server/engineering/default-definitions");

test.after(() => {
  profiles.close();
  fs.rmSync(state, { recursive: true, force: true });
});

test("기본 프로필은 하네스마다 하나씩 같은 이름·역할·지시·모델로 만들어진다", () => {
  const ids = ensureProfiles();
  assert.deepEqual(Object.keys(ids).sort(), Object.keys(HARNESSES).sort());
  const saved = new Map(profiles.list().map((profile) => [profile.name, profile]));
  assert.equal(saved.size, Object.keys(HARNESSES).length);
  for (const [key, harness] of Object.entries(HARNESSES)) {
    const profile = saved.get(harness.name);
    assert.equal(profile.id, ids[key]);
    assert.equal(profile.adapter, "claude");
    assert.equal(profile.role, harness.role);
    assert.equal(profile.instructions, harness.instructions);
    assert.equal(profile.model, MODELS[harness.model].model);
    assert.deepEqual(PROFILES[key], { name: profile.name, adapter: "claude", model: profile.model, provider: "", role: profile.role, instructions: profile.instructions });
  }
});

test("프로필을 다시 만들어도 중복되지 않고 사용자가 고친 프로필은 덮어쓰지 않는다", () => {
  const before = ensureProfiles();
  const target = profiles.list().find(({ name }) => name === HARNESSES.devNode.name);
  const edited = profiles.save({ ...target, instructions: "사용자가 고친 지시" });
  assert.equal(edited.version, target.version + 1);
  assert.deepEqual(ensureProfiles(), before);
  assert.equal(profiles.list().length, Object.keys(HARNESSES).length);
  assert.equal(profiles.list().find(({ name }) => name === HARNESSES.devNode.name).instructions, "사용자가 고친 지시");
  profiles.save({ ...edited, instructions: HARNESSES.devNode.instructions });
});

test("프로필 → 하네스 → 루프가 이름과 내용으로 이어지고, 기본 프로필은 Workflow 에이전트 노드에 연결된다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-profile-chain-"));
  const db = openDatabase(path.join(root, "engineering.sqlite"));
  try {
    const catalogues = catalog(db);
    addPresetDefinitions(db, catalogues, null);
    const definitions = catalogues.definitions(null, "personal");
    const harness = (name) => definitions.find((entry) => entry.kind === "harness" && entry.name === name);
    const byName = new Map(profiles.list().map((profile) => [profile.name, profile]));
    for (const [key, spec] of Object.entries(HARNESSES)) {
      const saved = harness(spec.name).payload, profile = byName.get(spec.name);
      assert.equal(saved.role, profile.role, `${spec.name}: role`);
      assert.equal(saved.instructions, profile.instructions, `${spec.name}: instructions`);
      assert.equal(catalogues.dependency(harness(spec.name)).payload.model, profile.model, `${spec.name}: model`);
    }
    for (const loop of Object.values(LOOPS)) {
      const saved = definitions.find((entry) => entry.kind === "loop" && entry.name === loop.name);
      const bound = definitions.find((entry) => entry.id === saved.payload.harness);
      assert.ok(byName.has(bound.name), `${loop.name} → ${bound.name} must have a matching profile`);
    }

    db.prepare("INSERT INTO project VALUES (?,?,?,?,0)").run("one", root, "Fixture", "main");
    const workflows = workflowCatalog(db, catalogues);
    const reviewer = byName.get(HARNESSES.reviewer.name);
    const plan = workflows.executionPlan("one", {
      name: "프로필 연결",
      nodes: [{ id: "start", label: "Start", type: "start", x: 0, y: 0 },
        { id: "profile", label: reviewer.name, type: "profile", profileId: reviewer.id, profileVersion: reviewer.version, x: 0, y: 100 },
        { id: "review", label: "코드 리뷰", type: "agent", instruction: "Review.\nOUTPUT FILE: .workflow-output/review.md",
          outputs: [{ name: "review", path: ".workflow-output/review.md" }], x: 160, y: 0 },
        { id: "end", label: "End", type: "end", x: 320, y: 0 }],
      edges: [{ from: "start", to: "review", port: "next" }, { from: "profile", to: "review", port: "profile" },
        { from: "review", to: "end", port: "next" }],
    });
    const node = plan.document.nodes.find(({ id }) => id === "review");
    assert.equal(node.sessionProfile.name, HARNESSES.reviewer.name);
    assert.equal(node.sessionProfile.model, MODELS.fable.model);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
