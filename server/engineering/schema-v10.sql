CREATE TABLE workflow_staging (
  run TEXT PRIMARY KEY REFERENCES workflow_delivery(run), environment TEXT NOT NULL CHECK (environment IN ('test','staging')),
  state TEXT NOT NULL CHECK (state IN ('dispatching','dispatched','linked')),
  approved INTEGER NOT NULL, workflow_run INTEGER, url TEXT, conclusion TEXT
) STRICT;
