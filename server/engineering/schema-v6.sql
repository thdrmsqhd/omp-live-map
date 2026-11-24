CREATE TABLE sdlc_task (
  id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES project(id), title TEXT NOT NULL, instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('backlog','ready','running','waiting_approval','blocked','completed')),
  workflow TEXT NOT NULL, workflow_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision>0),
  updated INTEGER NOT NULL, FOREIGN KEY (workflow,workflow_version) REFERENCES workflow_version(workflow,version)
) STRICT;
CREATE INDEX sdlc_task_board ON sdlc_task(project,status,updated);
ALTER TABLE workflow_run ADD COLUMN sdlc_task TEXT REFERENCES sdlc_task(id);
ALTER TABLE workflow_run ADD COLUMN sdlc_instruction TEXT;
CREATE INDEX workflow_run_sdlc_task ON workflow_run(sdlc_task,created);
