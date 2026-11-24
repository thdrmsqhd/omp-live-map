CREATE TABLE workflow_delivery (
  run TEXT PRIMARY KEY REFERENCES workflow_run(id), repository TEXT NOT NULL, base TEXT NOT NULL, head TEXT NOT NULL, sha TEXT NOT NULL,
  approved INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('approved','creating','created')),
  pr_number INTEGER, pr_url TEXT, ci_status TEXT, ci_checked INTEGER, release_approved INTEGER,
  CHECK ((pr_number IS NULL) = (pr_url IS NULL))
) STRICT;
