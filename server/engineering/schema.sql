CREATE TABLE project (
  id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, name TEXT NOT NULL, branch TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
) STRICT;
CREATE TABLE definition (
  id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES project(id), kind TEXT NOT NULL
    CHECK (kind IN ('model','harness','loop')), name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), UNIQUE (project, kind, name)
) STRICT;
CREATE TABLE definition_version (
  id TEXT NOT NULL REFERENCES definition(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0), payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (id, version)
) STRICT;
CREATE TABLE definition_ref (
  source TEXT NOT NULL, version INTEGER NOT NULL,
  target TEXT NOT NULL, target_version INTEGER NOT NULL,
  FOREIGN KEY (source, version) REFERENCES definition_version(id,version) ON DELETE CASCADE,
  FOREIGN KEY (target, target_version) REFERENCES definition_version(id,version),
  PRIMARY KEY (source, version, target)
) STRICT;
CREATE INDEX reference_target ON definition_ref(target, target_version);
CREATE TABLE task (
  id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES project(id), title TEXT NOT NULL,
  instruction TEXT NOT NULL
) STRICT;
CREATE TABLE run (
  id TEXT PRIMARY KEY, task TEXT NOT NULL REFERENCES task(id), definition TEXT NOT NULL,
  version INTEGER NOT NULL, status TEXT NOT NULL
    CHECK (status IN ('queued','running','paused','interrupted','blocked','succeeded','failed','cancelled','limit_exceeded')),
  workspace TEXT, created INTEGER NOT NULL, deadline INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  FOREIGN KEY (definition, version) REFERENCES definition_version(id,version)
) STRICT;
CREATE INDEX run_task ON run(task);
CREATE TABLE node_run (
  id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES run(id), name TEXT NOT NULL,
  UNIQUE(run,name)
) STRICT;
CREATE TABLE attempt (
  run TEXT NOT NULL REFERENCES run(id), number INTEGER NOT NULL CHECK (number > 0),
  status TEXT NOT NULL CHECK (status IN ('running','passed','rejected','error','uncertain','cancelled')),
  started INTEGER NOT NULL, ended INTEGER, outcome TEXT CHECK (outcome IS NULL OR json_valid(outcome)),
  PRIMARY KEY (run, number)
) STRICT;
CREATE TABLE approval (
  id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES run(id), created INTEGER NOT NULL, decision TEXT NOT NULL
    CHECK (decision IN ('approved','rejected'))
) STRICT;
CREATE TABLE artifact (
  id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES run(id), path TEXT NOT NULL, digest TEXT NOT NULL
) STRICT;
CREATE TABLE event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT REFERENCES run(id), created INTEGER NOT NULL,
  kind TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
CREATE INDEX event_run ON event(run,seq);
