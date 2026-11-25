function engineeringDefinitionLabel({ kind, scope, team, name }) {
  if (kind === "loop") return name;
  const owner = scope === "personal" ? "개인" : scope === "team" ? "팀 · " + team : "프로젝트";
  return "[" + owner + "] " + name;
}
