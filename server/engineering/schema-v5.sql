CREATE TABLE workflow_subgraph (
  workflow TEXT NOT NULL, version INTEGER NOT NULL, node TEXT NOT NULL,
  target TEXT NOT NULL, target_version INTEGER NOT NULL,
  PRIMARY KEY (workflow,version,node),
  FOREIGN KEY (workflow,version) REFERENCES workflow_version(workflow,version) ON DELETE CASCADE,
  FOREIGN KEY (target,target_version) REFERENCES workflow_version(workflow,version)
) STRICT;
