function engineeringDefinitionLabel({ scope, team, name }) {
  const owner = scope === "personal" ? "개인" : scope === "team" ? "팀 · " + team : "프로젝트";
  return "[" + owner + "] " + name;
}

// Workflow 목록 이름. 템플릿 빠른 실행이 만든 자동 사본(서버 목록의 generated)은 해시 대신 '사본'으로 구분한다.
function engineeringWorkflowLabel({ name, version, generated, template }) {
  const base = generated && template ? template + " · 자동 사본 " + name.slice(-12, -6) : name;
  return base + (version ? " · v" + version : "");
}
