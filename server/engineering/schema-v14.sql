-- v14: Workflow 도 정의처럼 개인·팀·프로젝트 범위를 갖는다. 실행(workflow_run)은 시작한 프로젝트를 직접 적는다.
-- project NOT NULL 을 풀려면 SQLite 는 테이블을 다시 만들어야 한다(v12 와 같은 방식, 외래 키 검사는 끈 채로).
CREATE TABLE scoped_workflow (
  id TEXT PRIMARY KEY,
  project TEXT REFERENCES project(id),
  team TEXT REFERENCES harness_team(name),
  scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('personal','team','project')),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK ((scope='project' AND project IS NOT NULL AND team IS NULL)
      OR (scope='team' AND project IS NULL AND team IS NOT NULL)
      OR (scope='personal' AND project IS NULL AND team IS NULL))
) STRICT;
INSERT INTO scoped_workflow(id,project,team,scope,name,version) SELECT id,project,NULL,'project',name,version FROM workflow;
DROP TABLE workflow;
ALTER TABLE scoped_workflow RENAME TO workflow;
CREATE UNIQUE INDEX workflow_project_name ON workflow(project,name) WHERE scope='project';
CREATE UNIQUE INDEX workflow_team_name ON workflow(team,name) WHERE scope='team';
CREATE UNIQUE INDEX workflow_personal_name ON workflow(name) WHERE scope='personal';
ALTER TABLE workflow_run ADD COLUMN project TEXT REFERENCES project(id);
UPDATE workflow_run SET project=(SELECT project FROM workflow WHERE workflow.id=workflow_run.workflow);
CREATE INDEX workflow_run_project ON workflow_run(project,created);
