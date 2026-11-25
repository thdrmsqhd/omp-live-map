CREATE TABLE reusable_definition (
  id TEXT PRIMARY KEY,
  project TEXT REFERENCES project(id),
  team TEXT REFERENCES harness_team(name),
  scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('personal','team','project')),
  kind TEXT NOT NULL CHECK (kind IN ('model','harness','loop')),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK ((scope='project' AND project IS NOT NULL AND team IS NULL)
      OR (scope='team' AND project IS NULL AND team IS NOT NULL)
      OR (scope='personal' AND project IS NULL AND team IS NULL))
) STRICT;
INSERT INTO reusable_definition SELECT * FROM definition;
DROP TABLE definition;
ALTER TABLE reusable_definition RENAME TO definition;
CREATE UNIQUE INDEX definition_project_name ON definition(project,kind,name) WHERE scope='project';
CREATE UNIQUE INDEX definition_team_name ON definition(team,kind,name) WHERE scope='team';
CREATE UNIQUE INDEX definition_personal_name ON definition(kind,name) WHERE scope='personal';
