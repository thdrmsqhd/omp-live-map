-- v13: 세션 프로필을 정의 범위 체계(개인·팀·프로젝트)에 넣는다.
-- definition.kind CHECK 에 'profile' 을 더하려면 SQLite 는 테이블을 다시 만들어야 한다(v12 와 같은 방식).
CREATE TABLE profile_definition (
  id TEXT PRIMARY KEY,
  project TEXT REFERENCES project(id),
  team TEXT REFERENCES harness_team(name),
  scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('personal','team','project')),
  kind TEXT NOT NULL CHECK (kind IN ('model','harness','loop','profile')),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK ((scope='project' AND project IS NOT NULL AND team IS NULL)
      OR (scope='team' AND project IS NULL AND team IS NOT NULL)
      OR (scope='personal' AND project IS NULL AND team IS NULL))
) STRICT;
INSERT INTO profile_definition SELECT * FROM definition;
DROP TABLE definition;
ALTER TABLE profile_definition RENAME TO definition;
CREATE UNIQUE INDEX definition_project_name ON definition(project,kind,name) WHERE scope='project';
CREATE UNIQUE INDEX definition_team_name ON definition(team,kind,name) WHERE scope='team';
CREATE UNIQUE INDEX definition_personal_name ON definition(kind,name) WHERE scope='personal';
-- 지운 프로필도 Workflow 가 고정한 버전은 계속 풀려야 하므로 행을 지우지 않고 은퇴로 표시한다.
CREATE TABLE definition_retired (
  id TEXT PRIMARY KEY REFERENCES definition(id), retired INTEGER NOT NULL
) STRICT;
-- 이전 저장소(session-harness.sqlite)에서 한 번 가져왔는지 기록한다.
CREATE TABLE profile_import (
  source TEXT PRIMARY KEY, imported INTEGER NOT NULL, profiles INTEGER NOT NULL
) STRICT;
