"use strict";

const { timingSafeEqual } = require("node:crypto");
const path = require("node:path");
const { openDatabase } = require("./database");
const { catalog } = require("./catalog");
const { runStore } = require("./run-store");
const { loopEngine } = require("./loop");
const { secureRunner } = require("./runner");
const { worktrees } = require("./worktree");
const { integer, string } = require("./definitions");
const { problem } = require("./state");

const prefix = "/api/engineering/";
const limit = 64 * 1024;

function reply(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw problem(413, "Request is too large");
  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw problem(400, "JSON object required");
  }
}

function authenticated(req, token) {
  if (!token) return false;
  const supplied = Buffer.from(String(req.headers["x-omp-engineering-token"] ?? ""));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function createEngineeringRoutes({ token, directory, runner = secureRunner() }) {
  let services;
  function initialize() {
    if (services) return services;
    const db = openDatabase(path.resolve(directory, "engineering.sqlite"));
    try {
      const definitions = catalog(db);
      const runs = runStore(db, definitions);
      runs.recover();
      services = { definitions, runs, loop: loopEngine(runs, definitions, runner, worktrees(path.resolve(directory, "worktrees"))) };
      return services;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  async function route(req, res, url) {
    if (!authenticated(req, token)) return reply(res, 403, { error: "Engineering session is required" });
    try {
      const { definitions, runs, loop } = initialize();
      const endpoint = url.pathname.slice(prefix.length);
      const query = (key) => string(url.searchParams.get(key), key);
      let result;
      if (req.method === "GET") {
        if (endpoint === "projects") result = definitions.projects();
        if (endpoint === "definitions") result = definitions.definitions(query("project"));
        if (endpoint === "runs") result = runs.list(query("project"));
        if (endpoint === "run") {
          const id = query("id");
          result = { run: runs.get(id), attempts: runs.attempts(id) };
        }
        if (endpoint === "capabilities") result = { omp: runner.available("omp"), claude: runner.available("claude") };
        if (endpoint === "events") {
          const after = integer(Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0), "event cursor", 0, Number.MAX_SAFE_INTEGER);
          const events = runs.events(after);
          if (String(req.headers.accept).includes("text/event-stream")) {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
            for (const entry of events) res.write(`id: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`);
            return res.end();
          }
          result = events;
        }
      }
      if (req.method === "POST") {
        const input = await body(req);
        if (endpoint === "projects") result = await definitions.saveProject(input);
        if (endpoint === "projects/archive") result = definitions.archive(string(input.id, "project"));
        if (endpoint === "definitions") result = definitions.saveDefinition(input);
        if (endpoint === "definitions/remove") {
          definitions.remove(string(input.id, "definition"));
          result = { removed: true };
        }
        if (endpoint === "runs") result = loop.start(input, string(input.key, "idempotency key"));
        if (endpoint === "runs/action") result = loop.action(string(input.id, "run"), input.operation);
      }
      if (result === undefined) return reply(res, 404, { error: "Unknown engineering endpoint" });
      return reply(res, 200, result);
    } catch (error) {
      return reply(res, error.status ?? 500, { error: error.status ? error.message : "Engineering operation failed" });
    }
  }
  return route;
}

module.exports = { prefix, createEngineeringRoutes };
