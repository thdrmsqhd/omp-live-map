/* 순수 관제 계산. 경로를 근거로 프로젝트를 연결하며 근거 없는 SDLC 진행률은 만들지 않는다. */
function monitorPath(value) {
  const path = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path;
}
function monitorProjectFor(folder, projects) {
  const path = monitorPath(folder);
  if (!path) return null;
  return projects.filter((p) => {
    const root = monitorPath(p.root);
    return !p.archived && root && (path === root || path.startsWith(root + "/"));
  }).sort((a,b) => monitorPath(b.root).length - monitorPath(a.root).length)[0] || null;
}
// 자원 표본이 있는지: 서버(proc.js resFor)는 프로세스를 못 찾아도 res {cpu:0, mb:0, proc:0} 을 싣는다 — 그것은 0 이 아니라 '미수집'이다.
const monitorResMeasured = (res) => Boolean(res && Number.isFinite(res.mb) && res.proc !== 0);
function monitorSessionStats(session, memoryLimit) {
  const nodes = session.nodes || [];
  const main = nodes.find((n) => n.kind === "main");
  const measured = nodes.filter((n) => monitorResMeasured(n.res));
  const ram = measured.length ? measured.reduce((a,n) => a + n.res.mb, 0) : null;
  const cpuRows = measured.filter((n) => Number.isFinite(n.res.cpu));
  const cpu = cpuRows.length ? cpuRows.reduce((a,n) => a+n.res.cpu,0) : null;
  const tokens = nodes.reduce((a,n) => a+(n.tokens?.total || 0),0);
  const cost = nodes.reduce((a,n) => a+(Number(n.cost) || 0),0);
  const errors = nodes.reduce((a,n) => a+(Number(n.errors) || 0),0);
  return { main, ram, cpu, tokens, cost, errors, running: nodes.filter((n)=>n.status==="live").length, total:nodes.length,
    resourceWarning: ram !== null && ram >= memoryLimit };
}
function monitorGroupSessions(sessions, projects) {
  const groups = new Map();
  for (const project of projects.filter((p) => !p.archived)) groups.set("project:"+project.id, { key:"project:"+project.id, project, title:project.name, folder:project.root, sessions:[] });
  for (const session of sessions) {
    const main = (session.nodes || []).find((n) => n.kind === "main");
    if (!main) continue;
    const folder = main.cwd || session.folder || "";
    const project = monitorProjectFor(folder, projects);
    const key = project ? "project:"+project.id : "folder:"+monitorPath(folder);
    if (!groups.has(key)) groups.set(key,{key,project:null,title:folder.split(/[\\/]/).filter(Boolean).pop() || "미분류",folder,sessions:[]});
    groups.get(key).sessions.push(session);
  }
  return [...groups.values()];
}
