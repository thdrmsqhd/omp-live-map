CREATE TABLE workflow_retry (
  run TEXT NOT NULL REFERENCES workflow_run(id), node TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt>0), outcome TEXT NOT NULL CHECK (json_valid(outcome)),
  created INTEGER NOT NULL, PRIMARY KEY (run,node,attempt)
) STRICT;
