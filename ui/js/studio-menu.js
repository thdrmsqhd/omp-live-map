// 노드 캔버스(studio.js)에서 나눈 모듈: 노드 추가 메뉴·노드 메뉴.
// studio.js 의 상태·함수는 S 로 받는다. let 상태(wf·project 등)는 S 의 getter·setter 로 읽고 쓴다.
import { h, KIND_LABELS, STEP_TYPES, STEP_HINTS, HARNESS_TEMPLATES, HARNESS_CATALOG, harnessTypeOf, isEvaluationHarness, EXTERNAL_LANE_X } from "./studio-nodes.js";
import { TYPE_LABELS } from "./studio-shared.js";
export function bindStudioMenu(S) {
  const { canvas, desktop, el, guard, inspect, isDirty, libraryNodes, menu, menuList, menuSearch, nameOf, nodes, ownerOf, pinned, say, steps, viewport } = S;
  const addDefaults = (...args) => S.addDefaults(...args);
  const connectEnds = (...args) => S.connectEnds(...args);
  const createLibrary = (...args) => S.createLibrary(...args);
  const createStep = (...args) => S.createStep(...args);
  const firstSocket = (...args) => S.firstSocket(...args);
  const labelOf = (...args) => S.labelOf(...args);
  const ownerFor = (...args) => S.ownerFor(...args);
  const remember = (...args) => S.remember(...args);
  const removeNode = (...args) => S.removeNode(...args);
  const render = (...args) => S.render(...args);
  const revert = (...args) => S.revert(...args);
  const saveLayout = (...args) => S.saveLayout(...args);
  const select = (...args) => S.select(...args);
  const visibleNodes = (...args) => S.visibleNodes(...args);
  // ---- 노드 추가 메뉴 ------------------------------------------------------------
  function menuItems(origin) {
    const items = [];
    // 정의 노드에서 끌어 만든 새 정의는 같은 저장 범위로 만든다(하네스-모델은 같은 범위여야 연결된다).
    const source = origin && nodes.get(origin.key);
    const owner = source && ["model", "harness", "loop"].includes(source.kind) ? ownerOf(source) : null;
    const libraryOwner = () => owner ? { ...owner } : ownerFor("personal");
    items.push({ group: "정의", label: "새 모델", hint: "모델과 추론 수준", out: "model", in: [],
      create: (at) => createLibrary("model", at, { owner: libraryOwner() }) });
    for (const [template, [role]] of Object.entries(HARNESS_TEMPLATES)) {
      items.push({ group: "정의", label: "새 하네스 · " + role, hint: "역할·작업 지시·규칙·스킬", out: "harness", in: ["model"],
        create: (at) => createLibrary("harness", at, { template, owner: libraryOwner() }) });
    }
    items.push({ group: "정의", label: "새 하네스 · 빈 하네스", hint: "직접 작성", out: "harness", in: ["model"],
      create: (at) => createLibrary("harness", at, { owner: libraryOwner() }) });
    items.push({ group: "정의", label: "새 루프", hint: "재시도·검증 명령·예산", out: "loop", in: ["harness"],
      create: (at) => createLibrary("loop", at, { owner: libraryOwner() }) });
    items.push({ group: "정의", label: "새 에이전트 프로필", hint: "실행기·모델·역할", out: "profile", in: [],
      create: (at) => createLibrary("profile", at, { owner: ownerFor("personal") }) });
    for (const family of HARNESS_CATALOG.families) {
      for (const type of HARNESS_CATALOG.types.filter((type) => type.family === family.id)) {
        items.push({ group: family.label, label: type.label, hint: type.output, search: `새 하네스 ${type.id} ${type.outputSchema}`,
          out: "harness", in: ["model"], evaluation: type.id === "evaluation",
          create: (at) => createLibrary("harness", at, { template: type.id, owner: libraryOwner() }) });
      }
    }
    if (S.wf) {
      for (const type of ["agent", "loop", "command", "condition", "approval", "parallel", "join", "subgraph", "end"]) {
        if (type === "end" && steps().some(({ data }) => data.type === "end")) continue;
        items.push({ group: "Workflow 단계", label: STEP_TYPES[type], hint: STEP_HINTS[type] ?? "", out: type === "end" ? null : "flow",
          in: ["flow", ...(type === "agent" ? ["harness", "profile"] : type === "loop" ? ["loop"] : [])], create: (at) => createStep(type, at) });
      }
    }
    const shown = new Set(visibleNodes().map(({ key }) => key));
    for (const node of libraryNodes().filter(({ key }) => !shown.has(key))) {
      const type = node.kind === "harness" ? harnessTypeOf(node.draft.role) : null;
      items.push({ group: "저장된 정의 불러오기", label: labelOf(node), hint: (type?.label ?? KIND_LABELS[node.kind]) + " · v" + (node.record?.version ?? "-"),
        search: type ? `${type.id} ${type.outputSchema}` : "", out: node.kind, in: Object.keys(node.ref),
        evaluation: isEvaluationHarness(node),
        create: (at) => {
          pinned.add(node.key);
          node.x = isEvaluationHarness(node) ? EXTERNAL_LANE_X : at.x;
          node.y = at.y;
          remember(node);
          saveLayout();
          return node;
        } });
    }
    if (!origin) {
      if (desktop()) items.push({ group: "빠른 시작", label: "기본 구성 추가", hint: "기본 모델·하네스·루프·프로필을 개인 범위에 추가", out: null, in: [],
        create: () => { void addDefaults(); return null; } });
      return items;
    }
    const originNode = nodes.get(origin.key);
    const externalOut = origin.dir === "out" && isEvaluationHarness(originNode);
    const stepHarnessIn = origin.dir === "in" && origin.type === "harness" && originNode?.kind === "step";
    return items.filter((item) => {
      if (origin.dir === "out") {
        if (externalOut && item.group === "Workflow 단계") return false;
        return item.in.includes(origin.type);
      }
      if (stepHarnessIn && item.evaluation) return false;
      return item.out === origin.type;
    });
  }
  let menuState = null;
  function openMenu(clientX, clientY, origin) {
    const bounds = el("graph").getBoundingClientRect();
    menuState = { at: canvas.point(clientX, clientY), origin, items: menuItems(origin) };
    menu.hidden = false;
    menu.style.left = Math.min(clientX - bounds.left, bounds.width - 300) + "px";
    menu.style.top = Math.min(clientY - bounds.top, bounds.height - 360) + "px";
    el("menu-title").textContent = origin ? `${TYPE_LABELS[origin.type]} ${origin.dir === "out" ? "출력에 연결할" : "입력에 연결할"} 노드` : "노드 추가";
    menuSearch.hidden = false;
    menuSearch.value = "";
    paintMenu();
    menuSearch.focus();
  }
  function paintMenu() {
    if (!menuState) return;
    const query = menuSearch.value.trim().toLowerCase();
    const items = menuState.items.filter(({ label, hint, group, search = "" }) => !query || `${label} ${hint} ${group} ${search}`.toLowerCase().includes(query));
    let group = "";
    const rows = [];
    items.forEach((item, index) => {
      if (item.group !== group) { group = item.group; rows.push(h("li", { class: "studio-menu-group", role: "presentation" }, group)); }
      rows.push(h("li", { role: "none" }, h("button", { type: "button", role: "menuitem", class: index === 0 ? "is-first" : "",
        onclick: () => pick(item) }, h("span", {}, item.label), h("small", {}, item.hint))));
    });
    if (!items.length) rows.push(h("li", { class: "studio-menu-group" }, "맞는 노드가 없습니다."));
    menuList.replaceChildren(...rows);
    menuState.filtered = items;
  }
  function pick(item) {
    const { at, origin } = menuState;
    closeMenu();
    const node = item.create(at);
    if (!node) return;
    if (origin) {
      const match = firstSocket(node, origin.dir === "out" ? "in" : "out", origin.type);
      if (match) connectEnds(origin, { key: node.key, slot: match.slot, type: match.type });
    }
    S.selected = node.key;
    render();
    say(`${nameOf(node)} 노드를 추가했습니다.` + (node.isNew ? " 노드 아래 ‘저장’ 또는 위의 ‘변경 저장’으로 저장하세요." : ""));
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menuState = null;
  }
  menuSearch.addEventListener("input", paintMenu);
  menuSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && menuState?.filtered?.length) { event.preventDefault(); pick(menuState.filtered[0]); }
    if (event.key === "Escape") { closeMenu(); viewport.focus(); }
  });

  // ---- 노드 메뉴 ---------------------------------------------------------------
  function nodeMenu(event, node) {
    event.stopPropagation();
    const items = [];
    if (node.kind === "step") {
      if (!["start", "end"].includes(node.data.type)) {
        items.push(["복제", () => {
          const copy = createStep(node.data.type, { x: node.x + 40, y: node.y + 40 });
          Object.assign(copy.data, structuredClone({ ...node.data, id: copy.data.id, label: node.data.label + " 복제" }));
          copy.ref = { ...node.ref };
          copy.version = node.version;
          copy.profileVersion = node.profileVersion;
          return copy;
        }], ["단계 삭제", () => removeNode(node)]);
      }
    } else {
      items.push(["복제", () => {
        const payload = structuredClone(node.draft);
        payload.name = node.draft.name + " 복제";
        const copy = createLibrary(node.kind, { x: node.x + 40, y: node.y + 40 }, { owner: { ...ownerOf(node) }, payload });
        copy.ref = { ...node.ref };
        return copy;
      }]);
      items.push([node.kind === "harness" ? "상세 · 버전 기록 · 실제 적용값 · 비교 실행" : "상세 · 버전 기록", () => { select(node.key); inspect.open(node); }]);
      if (isDirty(node) && !node.isNew) items.push(["되돌리기", () => revert(node)]);
      if (S.wf && S.mode !== "all" && pinned.has(node.key)) items.push(["캔버스에서 숨기기", () => { pinned.delete(node.key); render(); }]);
      items.push([node.isNew ? "삭제(저장 안 함)" : node.kind === "profile" ? "프로필 삭제" : "정의 삭제", () => removeNode(node)]);
    }
    const bounds = el("graph").getBoundingClientRect();
    menuState = { at: { x: node.x, y: node.y }, items: [] };
    menu.hidden = false;
    menu.style.left = Math.min(event.clientX - bounds.left, bounds.width - 300) + "px";
    menu.style.top = Math.min(event.clientY - bounds.top, bounds.height - 200) + "px";
    el("menu-title").textContent = nameOf(node);
    menuSearch.hidden = true;
    menuList.replaceChildren(...items.map(([label, run]) => h("li", { role: "none" }, h("button", { type: "button", role: "menuitem",
      onclick: guard(async () => {
        closeMenu();
        const result = await run();
        if (result?.key) { S.selected = result.key; render(); }
      }) }, h("span", {}, label)))));
    menuList.querySelector("button")?.focus();
  }
  const menuObserver = new MutationObserver(() => { if (menu.hidden) menuSearch.hidden = false; });
  menuObserver.observe(menu, { attributes: true, attributeFilter: ["hidden"] });

  const { request, notifyChanged } = S;
  const loadWorkflows = (...args) => S.loadWorkflows(...args);
  const fillWorkflowPicker = (...args) => S.fillWorkflowPicker(...args);
  // Workflow ⋯ 메뉴: 기본 Workflow 추가, JSON 내보내기·가져오기. 노드 추가 메뉴와 같은 #studio-menu 를 쓴다.
  function workflowMenu(event) {
    event.stopPropagation();
    const items = [
      ["기본 Workflow 8종 추가", async () => {
        if (!S.project) throw new Error("작업 프로젝트를 선택하세요.");
        const { created, skipped } = await request("workflows/presets/all", {}, { project: S.project.id });
        await loadWorkflows();
        fillWorkflowPicker(S.wf ? S.wf.record?.id ?? "new" : "");
        say(`기본 Workflow ${created.length}개를 추가했습니다.` + (skipped.length ? ` 이미 있는 ${skipped.length}개는 건너뛰었습니다.` : ""), "ok");
        notifyChanged?.();
      }],
    ];
    if (S.wf?.record) items.push(["이 Workflow를 JSON으로 내보내기", async () => {
      const template = await request("workflows/export", { project: S.project.id, id: S.wf.record.id, version: String(S.wf.record.version) });
      const resource = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
      const link = h("a", { href: resource, download: S.wf.record.name.replace(/[<>:"/\\|?*]/g, "-") + ".workflow.json" });
      link.click();
      setTimeout(() => URL.revokeObjectURL(resource), 1000);
    }]);
    items.push(["JSON에서 Workflow 가져오기…", () => {
      if (!S.project) throw new Error("작업 프로젝트를 선택하세요.");
      el("import-file").click();
    }]);
    const bounds = el("graph").getBoundingClientRect(), anchor = event.currentTarget.getBoundingClientRect();
    menuState = { at: canvas.center(), items: [] };
    menu.hidden = false;
    menu.style.left = Math.max(0, Math.min(anchor.left - bounds.left, bounds.width - 300)) + "px";
    menu.style.top = "8px";
    el("menu-title").textContent = "Workflow";
    menuSearch.hidden = true;
    menuList.replaceChildren(...items.map(([label, run]) => h("li", { role: "none" }, h("button", { type: "button", role: "menuitem",
      onclick: guard(async () => { closeMenu(); await run(); }) }, h("span", {}, label)))));
    menuList.querySelector("button")?.focus();
  }
  return { closeMenu, menuItems, nodeMenu, openMenu, paintMenu, pick, workflowMenu };
}
