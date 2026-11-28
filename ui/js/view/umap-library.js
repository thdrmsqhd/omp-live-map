/* omp-live-map · view · 라이브러리 서랍(맵 왼쪽 위 '라이브러리'): 하네스 · 루프 · 모델 · Workflow 템플릿을 한 정의 = 한 줄의 표로 보고 새로 만들기·복제·지우기.
   펼치는 줄·입력 폼은 없다: 칸의 글자를 누르면 그 칸에서 바로 고친다(inlineEdit, Enter·포커스 이동 = 저장, Esc = 취소 · 고를 값은 제자리 메뉴).
   저장하면 정의는 새 버전으로 쌓인다. 줄 끝 ⋯ = 복제 · 삭제. 서버: definitions · definitions/remove · workflows · workflows/remove. */

const UML = { tab: "harness", fresh: "", project: "" };
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
    umEl("button", { type: "button", textContent: label, dataset: { tab: id }, onclick: () => { UML.tab = id; UML.fresh = ""; void paintLibrary(list, tabs); } })));
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
  const repaint = () => paintLibrary(list, tabs);
  const cols = umlColumns(UML.tab);
  const head = umEl("tr", {}, ...cols.map(([title]) => umEl("th", { scope: "col" }, title)), umEl("th", { scope: "col" }, "범위"), umEl("th", { scope: "col" }, umEl("span", { className: "sr-only" }, "메뉴")));
  const table = umEl("table", { className: "um-lib-table" }, umEl("thead", {}, head), umEl("tbody", {}, ...shown.map((row) => umlRow(row, rows, cols, repaint))));
  list.replaceChildren(umEl("div", { className: "um-lib-head" }, create, umEl("small", { className: "um-muted" }, shown.length + "개 · 칸을 눌러 고치기" + (hidden ? " · Task 전용 사본 " + hidden + "개는 숨김" : ""))),
    shown.length ? table : umEl("p", { className: "um-muted" }, "아직 없습니다 · ＋ 새 " + label));
  list.querySelector("tr.fresh .um-cell")?.focus({ preventScroll: true });
}

// 탭마다 칸: [제목, 값 읽기(row), 고치기 { save(row, value), options, multiline, type, show }]
function umlColumns(tab) {
  const defs = () => UM.definitions.get(UML.project) || [];
  const sameOwner = (row) => (item) => item.scope === row.scope && (item.project ?? null) === (row.project ?? null) && (item.team ?? null) === (row.team ?? null);
  const name = ["이름", (row) => row.name, { save: (row, value) => value ? (tab === "workflow" ? umlRenameFlow(row, value) : umlSave(row, { name: value })) : Promise.reject(new Error("이름을 비울 수 없습니다.")) }];
  const number = (key, min, max, unit, scale = 1, digits = 0) => [(row) => (row.payload[key] / scale).toFixed(digits),
    { type: "number", min, max, show: (v) => v + unit, save: (row, value) => {
      const n = Number(value); if (!(Number.isFinite(n) && n >= min && n <= max)) throw new Error(min + "~" + max + " 사이로 쓰세요.");
      return umlSave(row, { [key]: Math.round(n * scale) }); } }];
  // 예산은 원화로 보이고 원화로 고친다(저장은 센트).
  const budget = [(row) => won(wonOfCents(row.payload.budgetCents)), { show: (v) => won(centsOfWon(v) / 100 * FX),
    save: (row, value) => umlSave(row, { budgetCents: umapCentsOf(100000, "예산")(value) }) }];
  if (tab === "model") return [name, ["모델 ID", (row) => row.payload.model, { save: (row, model) => umlSave(row, { model }) }],
    ["제공자", (row) => row.payload.provider, { save: (row, provider) => umlSave(row, { provider }) }]];
  if (tab === "harness") return [name,
    ["실행기", (row) => row.payload.adapter, { options: () => [["claude", "Claude Code"], ["omp", "OMP"]], show: (v) => (v === "omp" ? "OMP" : "Claude Code"), save: (row, adapter) => umlSave(row, { adapter }) }],
    ["모델", (row) => row.payload.model, { options: (row) => defs().filter((item) => item.kind === "model" && sameOwner(row)(item)).map((item) => [item.id, item.name]),
      show: (v) => defs().find(({ id }) => id === v)?.name || v, save: (row, model) => umlSave(row, { model }) }],
    ["역할", (row) => row.payload.role, { save: (row, role) => umlSave(row, { role }) }],
    ["지시", (row) => row.payload.instructions, { multiline: true, save: (row, instructions) => umlSave(row, { instructions }) }]];
  if (tab === "loop") return [name,
    ["하네스", (row) => row.payload.harness, { options: () => defs().filter((item) => item.kind === "harness").map((item) => [item.id, item.name]),
      show: (v) => defs().find(({ id }) => id === v)?.name || v, save: (row, harness) => umlSave(row, { harness }) }],
    ["시도", ...number("attempts", 1, 8, "회")], ["시간", ...number("timeoutMs", 1, 60, "분", 60000)], ["예산", ...budget],
    ["검증 명령", (row) => row.payload.checks.map(umapCommandText).join("\n"), { multiline: true, save: (row, text) => umlSave(row, { checks: text.split(/\n+/).filter(Boolean).map(umapParseCommand) }) }]];
  return [name, ["단계", (row) => row.stages || "…", { readonly: true }]];
}

function umlRow(row, all, cols, repaint) {
  const cells = cols.map(([title, get, edit]) => {
    const show = (v) => (edit.show ? edit.show(v) : String(v ?? "")) || "—";
    if (edit.readonly) return umEl("td", { className: "um-ro", title: String(get(row)) }, show(get(row)));
    const cell = umEl("button", { type: "button", className: "um-cell" + (edit.multiline ? " multi" : ""), textContent: show(get(row)), title: title + " · " + String(get(row) ?? "") + " · 눌러서 고치기" });
    const done = () => { cell.textContent = show(get(row)); cell.title = title + " · " + String(get(row) ?? "") + " · 눌러서 고치기"; };
    const fail = (error) => { inlineFlash(cell, error.message); umapToast(error.message); };
    cell.onclick = () => {
      if (edit.options) {
        const options = edit.options(row);
        if (!options.length) return umapToast("고를 수 있는 " + title + "이(가) 없습니다.");
        return inlineMenu(cell, options.map(([id, label]) => ({ label: (id === get(row) ? "✓ " : "") + label, run: () => void Promise.resolve(edit.save(row, id)).then(done, fail) })));
      }
      inlineEdit(cell, { value: String(get(row) ?? ""), label: title, type: edit.type, min: edit.min, max: edit.max, multiline: edit.multiline,
        onSave: (value) => Promise.resolve(edit.save(row, value)).then(done, fail) });
    };
    return umEl("td", {}, cell);
  });
  const meta = umEl("td", { className: "um-ro" }, umlScope(row) + " · v" + row.version);
  const more = umEl("button", { type: "button", className: "um-cell-more", textContent: "⋯", onclick: (event) => umlMenu(event.currentTarget, row, all, repaint) });
  more.setAttribute("aria-label", row.name + " 메뉴");
  if (UML.tab === "workflow" && !row.stages) void umapRequest("workflow", { project: UML.project, id: row.id }).then((flow) => {
    row.stages = flow.payload.nodes.filter(({ type }) => type !== "start" && type !== "end").map((node) => node.label).join(" › ") || "(단계 없음)";
    cells[1].textContent = row.stages; cells[1].title = row.stages;
  }, () => {});
  return umEl("tr", { className: UML.fresh === row.id ? "fresh" : "" }, ...cells, meta, umEl("td", {}, more));
}
// 줄 ⋯: 복제 · 삭제(한 번 더 확인).
function umlMenu(anchor, row, all, repaint) {
  const remove = () => void (UML.tab === "workflow" ? umapRequest("workflows/remove", {}, { project: UML.project, id: row.id }) : umapRequest("definitions/remove", {}, { id: row.id }))
    .then(() => { umapToast("‘" + row.name + "’ 삭제했습니다."); return repaint(); }, (error) => umapToast(error.message === "Definition is referenced" ? "다른 정의·Workflow 가 쓰고 있어 지울 수 없습니다." : error.message));
  inlineMenu(anchor, [
    { label: "복제", run: () => void umlDuplicate(row, all).then(repaint, (error) => umapToast(error.message)) },
    { label: "삭제…", run: () => inlineMenu(anchor, [{ label: "‘" + row.name + "’ 정말 삭제", run: remove }, { label: "취소" }]) },
  ]);
}

// 정의 한 개 저장(새 버전). row 의 version 을 따라 올린다.
async function umlSave(row, patch) {
  const saved = await umapRequest("definitions", {}, { scope: row.scope, project: row.project ?? undefined, team: row.team ?? undefined,
    kind: row.kind, id: row.id, version: row.version, payload: { ...row.payload, ...patch } });
  Object.assign(row, { version: saved.version, name: saved.name, payload: saved.payload });
  UM.definitions.delete(UML.project);
  await umapDefinitions(UML.project, true).catch(() => {});
  void umapRefresh(true);
}
async function umlRenameFlow(row, name) {
  const flow = await umapRequest("workflow", { project: UML.project, id: row.id });
  const saved = await umapRequest("workflows", {}, { project: UML.project, id: row.id, version: flow.version, payload: { ...flow.payload, name } });
  Object.assign(row, { name: saved.name, version: saved.version });
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
    UML.fresh = saved.id;
    return;
  }
  const saved = await umapRequest("definitions", {}, { scope: row.scope, project: row.project ?? undefined, team: row.team ?? undefined, kind: row.kind,
    payload: { ...row.payload, name: umlUniqueName(row.name + " 사본", all) } });
  UML.fresh = saved.id;
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
  UML.fresh = saved?.id || "";
  UM.definitions.delete(project);
}
