"use strict";

// 에이전트 프로필을 하네스로 합친다(한 번만, 앱을 열 때). 예전에는 같은 역할을 '프로필'(대화형 세션·Workflow 프로필 노드)과
// '하네스'(자동 실행) 두 곳에 따로 두었다. 이제 하네스 하나만 쓴다.
//  1. 프로필마다 같은 이름의 하네스가 있으면 그것을 쓰고, 없으면 프로필의 이름·역할·지시·모델로 개인 범위 하네스를 만든다.
//  2. Workflow 의 프로필 노드(Agent ← Profile)를 Agent 가 그 하네스를 직접 고정하도록 바꾼다(저장된 모든 버전).
//  3. 정의 저장소의 프로필 행(kind='profile')을 지운다. 예전 session-harness.sqlite 의 profiles 표는 읽기만 한다.
const { transaction } = require("../infrastructure/sqlite");
const { event } = require("./catalog");
const { MODELS } = require("./default-definitions");

const MARK = "harness-merge";
const LEGACY = "session-harness";

function profileSources(db, legacy) {
  const found = new Map();
  const add = (id, version, raw, live) => {
    let payload;
    try { payload = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
    if (!payload || typeof payload !== "object") return;
    const entry = found.get(id) ?? { id, version: 0, payload: null, live: false };
    if (version >= entry.version) Object.assign(entry, { version, payload });
    entry.live ||= live;
    found.set(id, entry);
  };
  const retired = new Set(db.prepare("SELECT id FROM definition_retired").all().map(({ id }) => id));
  for (const row of db.prepare(`SELECT d.id, v.version, v.payload FROM definition d JOIN definition_version v ON v.id=d.id
    WHERE d.kind='profile'`).all()) add(row.id, row.version, row.payload, !retired.has(row.id));
  const imported = db.prepare("SELECT 1 FROM profile_import WHERE source=?").get(LEGACY);
  if (legacy && !imported) {
    const live = new Set(legacy.current.map(({ id }) => id));
    for (const row of [...legacy.history, ...legacy.current]) if (!found.has(row.id) || live.has(row.id)) add(row.id, row.version, row.payload, live.has(row.id));
  }
  return found;
}

function mergeProfilesIntoHarnesses(db, catalog, legacy) {
  const pending = db.prepare("SELECT 1 FROM profile_import WHERE source=?").get(MARK);
  const leftovers = db.prepare("SELECT 1 FROM definition WHERE kind='profile' LIMIT 1").get();
  const nodes = db.prepare(`SELECT workflow, version, payload FROM workflow_version WHERE payload LIKE '%"type":"profile"%'`).all();
  if (pending && !leftovers && !nodes.length) return { harnesses: 0, workflows: 0 };
  return transaction(db, () => {
    const profiles = profileSources(db, legacy);
    const personal = () => catalog.definitions(null, "personal");
    const created = new Map();
    let harnesses = 0, workflows = 0;
    // 모델 ID·공급자가 같은 개인 모델 정의를 쓰고, 없으면 만든다. 모델을 적지 않은 프로필은 기본 Sonnet 을 쓴다.
    function modelFor(profile) {
      const fallback = MODELS.sonnet;
      const model = String(profile.model || fallback.model);
      const provider = profile.adapter === "omp" ? String(profile.provider || "") || "anthropic" : "anthropic";
      const existing = personal().find((entry) => entry.kind === "model" && entry.payload.model === model && entry.payload.provider === provider);
      if (existing) return existing;
      const taken = new Set(personal().filter(({ kind }) => kind === "model").map(({ name }) => name));
      let name = model === fallback.model ? fallback.name : model;
      for (let n = 2; taken.has(name); n++) name = `${model} (${n})`;
      return catalog.writeDefinition({ scope: "personal", kind: "model", payload: { name, provider, model, reasoning: "" } });
    }
    // 같은 이름의 하네스(개인 범위 우선)를 쓰고, 없으면 프로필 내용으로 개인 하네스를 만든다.
    function harnessFor(profile, owner) {
      const name = String(profile.name || "하네스").trim().slice(0, 200) || "하네스";
      const sameName = (entry) => entry.kind === "harness" && entry.name === name;
      const mine = personal().find(sameName);
      if (mine) return mine;
      const shared = db.prepare("SELECT id FROM definition WHERE kind='harness' AND name=? ORDER BY scope").all(name)
        .map(({ id }) => catalog.versionOf(id)).find((entry) => !owner || catalog.availableToOwner(entry, owner));
      if (shared) return shared;
      if (created.has(name)) return created.get(name);
      const adapter = profile.adapter === "omp" ? "omp" : "claude";
      const record = catalog.writeDefinition({ scope: "personal", kind: "harness", payload: {
        name, adapter, model: modelFor(profile).id, role: String(profile.role || name).slice(0, 240),
        instructions: String(profile.instructions || "").slice(0, 12000) } });
      created.set(name, record);
      harnesses++;
      return record;
    }
    for (const profile of profiles.values()) if (profile.live) harnessFor(profile.payload, null);

    const owners = new Map(db.prepare("SELECT id, scope, project, team FROM workflow").all().map((row) => [row.id, row]));
    const update = db.prepare("UPDATE workflow_version SET payload=? WHERE workflow=? AND version=?");
    const pin = db.prepare("INSERT OR REPLACE INTO workflow_definition VALUES (?,?,?,?,?)");
    for (const row of nodes) {
      const payload = JSON.parse(row.payload);
      const byId = new Map(payload.nodes.map((node) => [node.id, node]));
      if (!payload.nodes.some(({ type }) => type === "profile")) continue;
      const owner = owners.get(row.workflow) ?? null;
      for (const edge of payload.edges.filter(({ port }) => port === "profile")) {
        const source = byId.get(edge.from), agent = byId.get(edge.to);
        if (!source || !agent) continue;
        const profile = profiles.get(source.profileId)?.payload ?? { name: source.label, role: source.label };
        const harness = harnessFor(profile, owner);
        agent.definition = harness.id;
        agent.version = harness.version;
        pin.run(row.workflow, row.version, agent.id, harness.id, harness.version);
      }
      payload.nodes = payload.nodes.filter(({ type }) => type !== "profile");
      payload.edges = payload.edges.filter(({ port }) => port !== "profile");
      update.run(JSON.stringify(payload), row.workflow, row.version);
      workflows++;
    }
    db.prepare("DELETE FROM definition_retired WHERE id IN (SELECT id FROM definition WHERE kind='profile')").run();
    db.prepare("DELETE FROM definition WHERE kind='profile'").run();
    const mark = db.prepare("INSERT OR REPLACE INTO profile_import VALUES (?,?,?)");
    mark.run(MARK, Date.now(), harnesses);
    if (legacy) mark.run(LEGACY, Date.now(), profiles.size);
    event(db, "profiles.merged", { harnesses, workflows });
    return { harnesses, workflows };
  });
}

module.exports = { mergeProfilesIntoHarnesses };
