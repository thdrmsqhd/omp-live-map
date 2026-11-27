-- v15: 칸반 칸은 사용자가 더하고 이름·순서를 바꾼다(칸별 기본 Workflow 연결은 없앤다).
-- Task 는 사용자가 더한 칸에도 놓이고, 카드마다 시간 한도·예산을 따로 고칠 수 있다(NULL 이면 기본값).
-- status CHECK 를 풀려면 SQLite 는 테이블을 다시 만들어야 한다(v12 와 같은 방식, 외래 키 검사는 끈 채로).
CREATE TABLE board_column (
  project TEXT NOT NULL REFERENCES project(id),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 64),
  label TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 50),
  PRIMARY KEY (project,status)
) STRICT;
INSERT INTO board_column SELECT project,status,label,position FROM sdlc_stage;
DROP TABLE sdlc_stage;
ALTER TABLE board_column RENAME TO sdlc_stage;
CREATE TABLE board_task (
  id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES project(id), title TEXT NOT NULL, instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 64),
  workflow TEXT NOT NULL, workflow_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision>0),
  updated INTEGER NOT NULL,
  timeout_ms INTEGER CHECK (timeout_ms BETWEEN 60000 AND 3600000),
  budget_cents INTEGER CHECK (budget_cents BETWEEN 0 AND 100000),
  FOREIGN KEY (workflow,workflow_version) REFERENCES workflow_version(workflow,version)
) STRICT;
INSERT INTO board_task SELECT id,project,title,instruction,status,workflow,workflow_version,revision,updated,NULL,NULL FROM sdlc_task;
DROP TABLE sdlc_task;
ALTER TABLE board_task RENAME TO sdlc_task;
CREATE INDEX sdlc_task_board ON sdlc_task(project,status,updated);
