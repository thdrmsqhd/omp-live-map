"use strict";

const fs = require("node:fs/promises");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { artifactText } = require("./workflow-artifact");
const { transaction } = require("../infrastructure/sqlite");
const { string } = require("./definitions");
const { problem, redact } = require("./state");

const rubricBytes = 32 * 1024;
const artifactBytes = 256 * 1024;
const caseLimit = 50;
const digestPattern = /^[a-f0-9]{64}$/;
const operators = new Set(["exists", "equals", "type", "atLeast", "atMost"]);
const types = new Set(["null", "boolean", "number", "string", "array", "object"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Stable structural JSON, without treating object property ordering as content.
function canonical(value, depth = 0) {
  if (depth > 20) throw problem(400, "Rubric values are nested too deeply");
  if (value === null || ["string", "boolean"].includes(typeof value) || Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => canonical(item, depth + 1)).join(",") + "]";
  if (object(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key], depth + 1)).join(",") + "}";
  throw problem(400, "Rubric values must be finite JSON");
}

function pointer(value) {
  if (typeof value !== "string" || value.length > 512 || (value && !value.startsWith("/")) || /~(?![01])/.test(value)) {
    throw problem(400, "Use a JSON Pointer such as /summary/count");
  }
  const segments = value === "" ? [] : value.slice(1).split("/");
  if (segments.length > 20) throw problem(400, "JSON Pointer has too many segments");
  return segments.map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function normalizeRubric(input) {
  if (!object(input) || Object.keys(input).some((key) => !["name", "cases"].includes(key)) ||
      !Array.isArray(input.cases) || !input.cases.length || input.cases.length > caseLimit) {
    throw problem(400, "A rubric requires a name and 1–50 cases");
  }
  const name = string(input.name, "rubric name", 120);
  const cases = input.cases.map((item) => {
    if (!object(item) || Object.keys(item).some((key) => !["path", "operator", "value"].includes(key)) || !operators.has(item.operator)) {
      throw problem(400, "Invalid rubric case; use path, operator and optional value");
    }
    pointer(item.path);
    const { path: field, operator, value } = item;
    const hasValue = Object.hasOwn(item, "value");
    if (operator === "exists" ? hasValue : !hasValue ||
        (operator === "type" && !types.has(value)) ||
        (["atLeast", "atMost"].includes(operator) && !Number.isFinite(value))) {
      throw problem(400, "Invalid value for rubric operator");
    }
    return hasValue ? { path: field, operator, value } : { path: field, operator };
  });
  const payload = canonical({ version: 1, name, cases });
  if (Buffer.byteLength(payload) > rubricBytes) throw problem(413, "Rubric exceeds 32 KiB");
  return { name, cases: cases.length, payload, digest: hash(payload) };
}

function jsonType(value) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

// Walk only own JSON fields (array length / prototype are not JSON fields).
function passes(document, item) {
  let current = document;
  for (const key of pointer(item.path)) {
    if (Array.isArray(current) ? !/^(0|[1-9][0-9]*)$/.test(key) : !object(current)) return false;
    if (!Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  if (item.operator === "exists") return true;
  if (item.operator === "type") return jsonType(current) === item.value && (item.value !== "number" || Number.isFinite(current));
  if (item.operator === "atLeast") return Number.isFinite(current) && current >= item.value;
  if (item.operator === "atMost") return Number.isFinite(current) && current <= item.value;
  // Excessively deep or non-finite actual values cannot equal a bounded expected value.
  try { return canonical(current) === canonical(item.value); } catch { return false; }
}

function openStore(directory) {
  const { DatabaseSync } = require("node:sqlite");
  const folder = path.resolve(directory, "independent-evaluation");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(folder, "evaluation.sqlite"));
  try {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS rubric (
        project TEXT NOT NULL, workflow TEXT NOT NULL, digest TEXT NOT NULL, name TEXT NOT NULL,
        cases INTEGER NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY(project,workflow,digest)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS evaluation (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, workflow TEXT NOT NULL, version INTEGER NOT NULL,
        runId TEXT NOT NULL, runCreated INTEGER NOT NULL, node TEXT NOT NULL, artifact TEXT NOT NULL,
        artifactPath TEXT NOT NULL, artifactDigest TEXT NOT NULL, rubricDigest TEXT NOT NULL,
        passed INTEGER NOT NULL, total INTEGER NOT NULL, score REAL NOT NULL, created INTEGER NOT NULL,
        baseline TEXT, decision TEXT, note TEXT, reviewed INTEGER,
        UNIQUE(project,runId,node,artifact,rubricDigest),
        FOREIGN KEY(project,workflow,rubricDigest) REFERENCES rubric(project,workflow,digest)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS evaluation_baseline ON evaluation(project,workflow,node,artifact,rubricDigest,runCreated DESC,runId);
      CREATE INDEX IF NOT EXISTS evaluation_history ON evaluation(project,runId,created DESC,id);`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function summary({ runCreated, baseline, decision, note, reviewed, ...row }) {
  const previous = baseline ? JSON.parse(baseline) : null;
  return { ...row, regression: previous ? {
    baseline: previous,
    delta: Number((row.score - previous.score).toFixed(1)),
    status: row.passed < previous.passed ? "regressed" : row.passed > previous.passed ? "improved" : "unchanged",
  } : null, manual: decision ? { decision, note, reviewed } : null };
}

function independentEvaluation({ db, directory, workspaceRoot, runs, definitions, workflows }) {
  let store;
  const database = () => store ??= openStore(directory);
  function completed(project, id) {
    const run = runs.get(string(id, "run"));
    if (run.project !== project) throw problem(404, "Workflow run not found in this project");
    if (run.status !== "succeeded") throw problem(409, "Only succeeded workflow runs can be evaluated");
    return run;
  }
  function artifacts(run) {
    if (!run.workspace) return [];
    return runs.nodes(run.id).flatMap(({ node, status, outcome }) => status === "succeeded" && Array.isArray(outcome?.artifacts)
      ? outcome.artifacts.filter((ref) => typeof ref?.name === "string" && typeof ref.path === "string" &&
        typeof ref.sha256 === "string" && digestPattern.test(ref.sha256) && Number.isSafeInteger(ref.byteLength) &&
        ref.byteLength > 0 && ref.byteLength <= artifactBytes)
        .map(({ name, path, sha256, byteLength }) => ({ node, name, path, sha256, byteLength })) : []);
  }
  function inspect(project, id) {
    definitions.project(project);
    const selected = id === null || id === undefined ? null : completed(project, id);
    const data = database();
    const list = db.prepare(`SELECT r.id,r.title,r.workflow,r.version,r.created FROM workflow_run r JOIN workflow w ON w.id=r.workflow
      WHERE w.project=? AND r.status='succeeded' AND r.workspace IS NOT NULL AND EXISTS (
        SELECT 1 FROM workflow_node n, json_each(n.outcome,'$.artifacts') a
        WHERE n.run=r.id AND n.status='succeeded' AND a.type='object' AND length(json_extract(a.value,'$.sha256'))=64
          AND json_extract(a.value,'$.byteLength') BETWEEN 1 AND ?
      ) ORDER BY r.created DESC,r.id LIMIT 100`).all(project, artifactBytes);
    const rubrics = selected ? data.prepare(`SELECT workflow,digest,name,cases,created FROM rubric WHERE project=? AND workflow=?
      ORDER BY created DESC,digest LIMIT 100`).all(project, selected.workflow) : data.prepare(`SELECT workflow,digest,name,cases,created FROM rubric
      WHERE project=? ORDER BY created DESC,digest LIMIT 100`).all(project);
    return { runs: list, rubrics, selected: selected ? {
      id: selected.id, title: selected.title, workflow: selected.workflow, version: selected.version, artifacts: artifacts(selected),
      evaluations: data.prepare("SELECT * FROM evaluation WHERE project=? AND runId=? ORDER BY created DESC,id LIMIT 100")
        .all(project, selected.id).map(summary),
    } : null };
  }
  function seal(project, input) {
    definitions.project(project);
    const workflow = string(input.workflow, "workflow");
    workflows.get(project, workflow);
    const { name, cases, payload, digest } = normalizeRubric(input.rubric);
    const data = database();
    return transaction(data, () => {
      const select = data.prepare("SELECT workflow,digest,name,cases,created FROM rubric WHERE project=? AND workflow=? AND digest=?");
      const existing = select.get(project, workflow, digest);
      if (existing) return existing;
      if (data.prepare("SELECT COUNT(*) AS count FROM rubric").get().count >= 500) throw problem(409, "Local rubric store limit reached");
      const created = Date.now();
      data.prepare("INSERT INTO rubric VALUES (?,?,?,?,?,?,?)").run(project, workflow, digest, name, cases, payload, created);
      return { workflow, digest, name, cases, created };
    });
  }
  async function evaluate(project, input) {
    const run = completed(project, input.id);
    const node = string(input.node, "node", 512);
    const artifact = string(input.artifact, "artifact name");
    const rubricDigest = input.rubricDigest;
    if (typeof rubricDigest !== "string" || !digestPattern.test(rubricDigest)) throw problem(400, "A sealed rubric SHA-256 pin is required");
    const data = database();
    const rubric = data.prepare("SELECT payload,cases FROM rubric WHERE project=? AND workflow=? AND digest=?").get(project, run.workflow, rubricDigest);
    if (!rubric) throw problem(404, "Pinned rubric not found for this workflow");
    if (hash(rubric.payload) !== rubricDigest) throw problem(409, "Sealed rubric integrity check failed");
    const matches = artifacts(run).filter((item) => item.node === node && item.name === artifact);
    if (matches.length !== 1) throw problem(404, "No unique recorded artifact matches this node and name within the evaluation limit");
    const ref = matches[0];
    let bytes;
    try {
      const root = await fs.realpath(workspaceRoot);
      const workspace = await fs.realpath(run.workspace);
      if (path.dirname(workspace) !== root || path.basename(workspace) !== run.id) throw new Error();
      const verified = await artifactText(workspace, ref, artifactBytes);
      if (verified.byteLength !== ref.byteLength) throw new Error();
      bytes = verified.bytes;
    } catch {
      throw problem(409, "Recorded artifact is changed, unavailable or outside the run worktree");
    }
    let document;
    try { document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch {
      throw problem(422, "Recorded artifact must contain valid UTF-8 JSON");
    }
    const checks = JSON.parse(rubric.payload).cases;
    if (checks.length !== rubric.cases) throw problem(409, "Sealed rubric integrity check failed");
    const total = checks.length;
    const passed = checks.filter((item) => passes(document, item)).length;
    const score = Math.round(passed * 1000 / total) / 10;
    return transaction(data, () => {
      const existing = data.prepare("SELECT * FROM evaluation WHERE project=? AND runId=? AND node=? AND artifact=? AND rubricDigest=?")
        .get(project, run.id, node, artifact, rubricDigest);
      if (existing) {
        if (existing.artifactDigest !== ref.sha256 || existing.artifactPath !== ref.path) throw problem(409, "Artifact does not match the previously evaluated output");
        return summary(existing);
      }
      if (data.prepare("SELECT COUNT(*) AS count FROM evaluation").get().count >= 5000) throw problem(409, "Local evaluation store limit reached");
      // The previous evaluated run is selected by run chronology, not by evaluation time.
      // Versions may differ; the project, workflow, node, output name and rubric digest must match.
      const baseline = data.prepare(`SELECT id,runId,version,passed,total,score FROM evaluation WHERE project=? AND workflow=?
        AND node=? AND artifact=? AND rubricDigest=? AND (runCreated<? OR (runCreated=? AND runId>?))
        ORDER BY runCreated DESC,runId ASC LIMIT 1`)
        .get(project, run.workflow, node, artifact, rubricDigest, run.created, run.created, run.id);
      const result = { id: randomUUID(), project, workflow: run.workflow, version: run.version, runId: run.id,
        runCreated: run.created, node, artifact, artifactPath: ref.path, artifactDigest: ref.sha256, rubricDigest, passed, total,
        score, created: Date.now(), baseline: baseline ? JSON.stringify(baseline) : null };
      data.prepare(`INSERT INTO evaluation (id,project,workflow,version,runId,runCreated,node,artifact,artifactPath,artifactDigest,rubricDigest,
        passed,total,score,created,baseline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(result));
      return summary(result);
    });
  }
  function review(project, input) {
    const run = completed(project, input.id);
    const evaluationId = string(input.evaluationId, "evaluation");
    const decision = input.decision;
    if (decision !== "pass" && decision !== "fail") throw problem(400, "Manual decision must be pass or fail");
    const note = input.note === undefined || input.note === "" ? "" : redact(string(input.note, "review note", 1000));
    const data = database();
    return transaction(data, () => {
      const result = data.prepare("SELECT * FROM evaluation WHERE project=? AND runId=? AND id=?").get(project, run.id, evaluationId);
      if (!result) throw problem(404, "Evaluation not found for this run");
      if (result.decision) {
        if (result.decision !== decision || result.note !== note) throw problem(409, "Manual decision is already recorded");
        return summary(result);
      }
      const reviewed = Date.now();
      data.prepare("UPDATE evaluation SET decision=?,note=?,reviewed=? WHERE id=?").run(decision, note, reviewed, evaluationId);
      return summary({ ...result, decision, note, reviewed });
    });
  }
  function post(input) {
    const project = string(input.project, "project");
    if (input.operation === "seal") return seal(project, input);
    if (input.operation === "evaluate") return evaluate(project, input);
    if (input.operation === "review") return review(project, input);
    throw problem(400, "Unknown evaluation operation");
  }
  return { inspect, post, close: () => { store?.close(); store = undefined; } };
}

module.exports = { independentEvaluation };
