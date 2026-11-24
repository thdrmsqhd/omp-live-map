CREATE TABLE sdlc_stage (
  project TEXT NOT NULL REFERENCES project(id), status TEXT NOT NULL
    CHECK (status IN ('backlog','ready','running','waiting_approval','blocked','completed')),
  label TEXT NOT NULL, position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 20),
  workflow TEXT, workflow_version INTEGER, PRIMARY KEY (project,status),
  CHECK ((workflow IS NULL) = (workflow_version IS NULL)),
  FOREIGN KEY (workflow,workflow_version) REFERENCES workflow_version(workflow,version)
) STRICT;
CREATE INDEX workflow_timeline ON event(json_extract(payload,'$.id'),seq) WHERE kind LIKE 'workflow.%';
