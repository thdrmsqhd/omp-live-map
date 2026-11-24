CREATE TABLE workflow_run (
  id TEXT PRIMARY KEY, workflow TEXT NOT NULL, version INTEGER NOT NULL,
  title TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_approval','paused','interrupted','succeeded','failed','cancelled','limit_exceeded')),
  workspace TEXT, created INTEGER NOT NULL, deadline INTEGER NOT NULL, budget INTEGER NOT NULL CHECK (budget>=0),
  idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, error TEXT,
  FOREIGN KEY (workflow, version) REFERENCES workflow_version(workflow, version)
) STRICT;
CREATE INDEX workflow_run_history ON workflow_run(workflow,created);
CREATE TABLE workflow_node (
  run TEXT NOT NULL REFERENCES workflow_run(id), node TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','waiting_approval','succeeded','failed','skipped','interrupted','cancelled')),
  outcome TEXT CHECK (outcome IS NULL OR json_valid(outcome)),
  updated INTEGER NOT NULL, PRIMARY KEY (run,node)
) STRICT;
