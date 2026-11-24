CREATE TABLE workflow (
  id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES project(id), name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), UNIQUE (project, name)
) STRICT;
CREATE TABLE workflow_version (
  workflow TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK (version > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)), PRIMARY KEY (workflow, version)
) STRICT;
CREATE TABLE workflow_definition (
  workflow TEXT NOT NULL, version INTEGER NOT NULL, node TEXT NOT NULL,
  target TEXT NOT NULL, target_version INTEGER NOT NULL,
  PRIMARY KEY (workflow, version, node),
  FOREIGN KEY (workflow, version) REFERENCES workflow_version(workflow, version) ON DELETE CASCADE,
  FOREIGN KEY (target, target_version) REFERENCES definition_version(id, version)
) STRICT;
CREATE INDEX workflow_definition_target ON workflow_definition(target, target_version);
