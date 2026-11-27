/* omp-live-map · view · 라이브러리 서랍(맵 왼쪽 위 '라이브러리'): 하네스 · 루프 · 모델 · Workflow 템플릿을 보고 새로 만들기·복제·지우기.
   이름을 누르면 그 줄 아래에서 바로 고친다(자동 저장, 정의는 새 버전으로 쌓인다). 서버: definitions · definitions/remove · workflows · workflows/remove. */

const UML = { tab: "harness", open: "", project: "" };
const UML_TABS = [["harness", "하네스"], ["loop", "루프"], ["model", "모델"], ["workflow", "Workflow"]];
const umlScope = (row) => row.scope === "team" ? "팀 " + row.team : row.scope === "project" ? "프로젝트" : "개인";
const umlLocal = (name) => / · Task [0-9a-f-]{8}$/.test(name);

function umlProject() {
  const band = UMAP_BANDS.find(({ key }) => key === umapCurrentBand());
  return band?.project?.id || UM.projects.find((project) => !project.archived)?.id || "";
}

async function openLibraryDrawer(tab) {
  if (tab) UML.tab = tab;
  UML.project = umlProject();
  if (!UML.project) {
    openUmapDrawer("library", "library", "라이브러리", [umEl("p", { className: "um-muted" }, "아직 프로젝트가 없습니다. 띠의 ＋ Task 로 첫 Task 를 만들면 그 폴더가 프로젝트가 되고 라이브러리를 쓸 수 있습니다.")], true);
    return;
  }
  const list = umEl("div", { className: "um-lib-list" }, umEl("p", { className: "um-muted" }, "불러오는 중…"));
  const tabs = umEl("div", { className: "um-seg um-lib-tabs", role: "tablist" }, ...UML_TABS.map(([id, label]) =>
    umEl("button", { type: "button", textContent: label, dataset: { tab: id }, onclick: () => { UML.tab = id; UML.open = ""; void paintLibrary(list, tabs); } })));
  const project = UM.projects.find(({ id }) => id === UML.project);
  openUmapDrawer("library", "library", "라이브러리 · " + (project?.name || ""), [tabs, list], true);
  await paintLibrary(list, tabs);
}

async function paintLibrary(list, tabs) {
  for (const button of tabs.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.tab === UML.tab));
  const project = UML.project;
  let rows;
  try {
    rows = UML.tab === "workflow" ? await umapRequest("workflows", { project })
      : (await umapDefinitions(project, true)).filter(({ kind }) => kind === UML.tab);
  } catch (error) { list.replaceChildren(umEl("p", { className: "um-note err" }, error.message)); return; }
  const shown = rows.filter((row) => !umlLocal(row.name) && !row.generated);
  const hidden = rows.length - shown.length;
  const label = UML_TABS.find(([id]) => id === UML.tab)[1];
  const create = umEl("button", { type: "button", className: "go", textContent: "＋ 새 " + label, onclick: () => void umlCreate().then(() => paintLibrary(list, tabs), (error) => umapToast(error.message)) });
  list.replaceChildren(umEl("div", { className: "um-lib-head" }, create, umEl("small", { className: "um-muted" }, shown.length + "개" + (hidden ? " · Task 전용 사본 " + hidden + "개는 숨김" : ""))),
    ...shown.map((row) => umlRow(row, rows, () => paintLibrary(list, tabs))));
}

function umlRow(row, all, repaint) {
  const id = row.id, open = UML.open === id;
  const name = umEl("button", { type: "button", className: "um-lib-name", textContent: row.name, title: "눌러서 고치기", onclick: () => { UML.open = open ? "" : id; void repaint(); } });
  const meta = umEl("small", { className: "um-muted" }, umlScope(row) + " · v" + row.version + (UML.tab === "harness" ? " · " + (row.payload.adapter === "omp" ? "OMP" : "Claude Code") : "")
    + (UML.tab === "loop" ? " · " + row.payload.attempts + "회 · " + Math.round(row.payload.timeoutMs / 60000) + "분" : "") + (UML.tab === "model" ? " · " + row.payload.model : ""));
  const copy = umEl("button", { type: "button", textContent: "복제", onclick: () => void umlDuplicate(row, all).then(repaint, (error) => umapToast(error.message)) });
  const remove = umEl("button", { type: "button", className: "stop", textContent: "삭제", onclick: (event) => {
    const button = event.currentTarget;
    if (button.dataset.armed !== "1") { button.dataset.armed = "1"; button.textContent = "정말 삭제"; setTimeout(() => { button.dataset.armed = ""; button.textContent = "삭제"; }, 3000); return; }
    void (UML.tab === "workflow" ? umapRequest("workflows/remove", {}, { project: UML.project, id }) : umapRequest("definitions/remove", {}, { id }))
      .then(repaint, (error) => umapToast(error.message === "Definition is referenced" ? "다른 정의·Workflow 가 쓰고 있어 지울 수 없습니다." : error.message));
  } });
  const line = umEl("div", { className: "um-lib-row" + (open ? " open" : "") }, umEl("div", { className: "um-lib-line" }, name, meta, umEl("span", { className: "um-spacer" }), copy, remove));
  if (open) line.append(umlEditor(row));
  return line;
}

// 정의 한 개 저장(새 버전). row 의 version 을 따라 올린다.
async function umlSave(row, patch) {
  const saved = await umapRequest("definitions", {}, { scope: row.scope, project: row.project ?? undefined, team: row.team ?? undefined,
    kind: row.kind, id: row.id, version: row.version, payload: { ...row.payload, ...patch } });
  Object.assign(row, { version: saved.version, name: saved.name, payload: saved.payload });
  UM.definitions.delete(UML.project);
  void umapRefresh(true);
}
function umlEditor(row) {
  const box = umEl("div", { className: "um-lib-edit" });
  const sameOwner = (item) => item.scope === row.scope && (item.project ?? null) === (row.project ?? null) && (item.team ?? null) === (row.team ?? null);
  if (UML.tab === "workflow") {
    box.append(umapField("이름", row.name, async (name) => {
      const flow = await umapRequest("workflow", { project: UML.project, id: row.id });
      const saved = await umapRequest("workflows", {}, { project: UML.project, id: row.id, version: flow.version, payload: { ...flow.payload, name } });
      Object.assign(row, { name: saved.name, version: saved.version });
    }), umEl("p", { className: "um-muted" }, "단계는 맵에서 Task ⋯ > Workflow 편집으로 넣고·옮기고·지웁니다(템플릿 범위)."));
    void umapRequest("workflow", { project: UML.project, id: row.id }).then((flow) => box.append(umEl("ol", { className: "um-dlist" },
      ...flow.payload.nodes.filter(({ type }) => type !== "start" && type !== "end").map((node) => umEl("li", {}, (UMAP_KIND[node.type] || node.type) + " · " + node.label)))));
    return box;
  }
  box.append(umapField("이름", row.name, (name) => umlSave(row, { name })));
  if (row.kind === "model") {
    box.append(umapField("모델 ID", row.payload.model, (model) => umlSave(row, { model })), umapField("제공자", row.payload.provider, (provider) => umlSave(row, { provider })));
  }
  if (row.kind === "harness") {
    const models = (UM.definitions.get(UML.project) || []).filter((item) => item.kind === "model" && sameOwner(item));
    box.append(umapSelectField("실행기", [["claude", "Claude Code"], ["omp", "OMP"]], row.payload.adapter, (adapter) => umlSave(row, { adapter })),
      umapSelectField("모델", models.map((model) => [model.id, model.name]), row.payload.model, (model) => umlSave(row, { model }), models.length ? "" : "같은 범위의 모델이 없습니다."),
      umapField("역할", row.payload.role, (role) => umlSave(row, { role })),
      umapField("지시", row.payload.instructions, (instructions) => umlSave(row, { instructions }), { multiline: true, rows: 6 }));
  }
  if (row.kind === "loop") {
    const harnesses = (UM.definitions.get(UML.project) || []).filter((item) => item.kind === "harness");
    box.append(umapSelectField("하네스", harnesses.map((item) => [item.id, item.name]), row.payload.harness, (harness) => umlSave(row, { harness })),
      umapField("최대 시도", String(row.payload.attempts), (value) => umlSave(row, { attempts: Math.round(Number(value)) }), { type: "number", min: 1, max: 8 }),
      umapField("시간 한도(분)", String(Math.round(row.payload.timeoutMs / 60000)), (value) => umlSave(row, { timeoutMs: Math.round(Number(value) * 60000) }), { type: "number", min: 1, max: 60 }),
      umapField("예산($)", (row.payload.budgetCents / 100).toFixed(2), (value) => umlSave(row, { budgetCents: Math.round(Number(value) * 100) }), { type: "number", min: 0, step: 0.01 }),
      umapField("검증 명령", row.payload.checks.map(umapCommandText).join("\n"), (text) => umlSave(row, { checks: text.split(/\n+/).filter(Boolean).map(umapParseCommand) }), { multiline: true, rows: 2 }));
  }
  return box;
}

function umlUniqueName(base, all) {
  const names = new Set(all.map(({ name }) => name));
  let name = base, index = 2;
  while (names.has(name)) name = base + " " + index++;
  return name;
}
async function umlDuplicate(row, all) {
  if (UML.tab === "workflow") {
    const flow = await umapRequest("workflow", { project: UML.project, id: row.id });
    const saved = await umapRequest("workflows", {}, { project: UML.project, scope: "project", payload: { ...flow.payload, name: umlUniqueName(row.name + " 사본", all) } });
    UML.open = saved.id;
    return;
  }
  const saved = await umapRequest("definitions", {}, { scope: row.scope, project: row.project ?? undefined, team: row.team ?? undefined, kind: row.kind,
    payload: { ...row.payload, name: umlUniqueName(row.name + " 사본", all) } });
  UML.open = saved.id;
}
async function umlCreate() {
  const project = UML.project;
  const definitions = await umapDefinitions(project, true);
  const personal = (kind) => definitions.find((item) => item.kind === kind && item.scope === "personal");
  const all = UML.tab === "workflow" ? await umapRequest("workflows", { project }) : definitions;
  let saved;
  if (UML.tab === "model") saved = await umapRequest("definitions", {}, { scope: "personal", kind: "model", payload: { name: umlUniqueName("새 모델", all), provider: "anthropic", model: "claude-sonnet-5-5" } });
  if (UML.tab === "harness") {
    const model = personal("model");
    if (!model) throw new Error("먼저 모델을 만드세요.");
    saved = await umapRequest("definitions", {}, { scope: "personal", kind: "harness", payload: { name: umlUniqueName("새 하네스", all), adapter: "claude", model: model.id, role: "역할을 적어 주세요" } });
  }
  if (UML.tab === "loop") {
    const harness = personal("harness");
    if (!harness) throw new Error("먼저 하네스를 만드세요.");
    saved = await umapRequest("definitions", {}, { scope: "personal", kind: "loop", payload: { name: umlUniqueName("새 루프", all), harness: harness.id, attempts: 3,
      timeoutMs: 1200000, budgetCents: 6000, checks: [{ command: "node", args: ["--test"], code: 0 }] } });
  }
  if (UML.tab === "workflow") {
    const refs = await umapRequest("workflows/presets/defaults", {}, { scope: "personal" });
    saved = await umapRequest("workflows/presets", {}, { project, preset: "feature", name: umlUniqueName("새 Workflow", all),
      refs: { author: refs.author, reviewer: refs.reviewer, triage: refs.triage, loop: refs.loop } });
  }
  UML.open = saved?.id || "";
  UM.definitions.delete(project);
}
