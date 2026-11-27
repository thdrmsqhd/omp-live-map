// 노드 캔버스(studio.js)에서 나눈 모듈: 저장·되돌리기·삭제(정의·Workflow API).
// studio.js 의 상태·함수는 S 로 받는다. let 상태(wf·project 등)는 S 의 getter·setter 로 읽고 쓴다.
import { KIND_LABELS } from "./studio-nodes.js";
import { KIND_ORDER } from "./studio-shared.js";
export function bindStudioPersist(S) {
  const { el, fingerprint, isDirty, libraryNodes, nameOf, nodes, notifyChanged, ownerOf, pinned, reinspect, request, say, steps, workflowDirty, workflowName } = S;
  const fillWorkflowPicker = (...args) => S.fillWorkflowPicker(...args);
  const idOf = (...args) => S.idOf(...args);
  const libraryNode = (...args) => S.libraryNode(...args);
  const loadWorkflows = (...args) => S.loadWorkflows(...args);
  const openDocument = (...args) => S.openDocument(...args);
  const remember = (...args) => S.remember(...args);
  const render = (...args) => S.render(...args);
  const saveLayout = (...args) => S.saveLayout(...args);
  const serialize = (...args) => S.serialize(...args);
  const spots = (...args) => S.spots(...args);
  const updateToolbar = (...args) => S.updateToolbar(...args);
  // ---- 저장·삭제 ---------------------------------------------------------------
  function rekey(node, key) {
    if (node.key === key) return;
    const old = node.key;
    nodes.delete(old);
    node.key = key;
    nodes.set(key, node);
    for (const other of nodes.values()) for (const [slot, value] of Object.entries(other.ref)) if (value === old) other.ref[slot] = key;
    if (pinned.delete(old)) pinned.add(key);
    if (S.selected === old) S.selected = key;
  }
  function payloadOf(node) {
    if (Object.keys(node.errors ?? {}).length) throw new Error(`${nameOf(node)}: ${Object.values(node.errors)[0]}`);
    if (node.kind === "model") {
      if (!node.draft.model) throw new Error(`${nameOf(node)}: 모델을 고르세요.`);
      return { name: node.draft.name, provider: node.draft.provider, model: node.draft.model, reasoning: node.draft.reasoning ?? "" };
    }
    if (node.kind === "harness") {
      if (!node.ref.model) throw new Error(`${nameOf(node)}: 모델 노드를 연결하세요.`);
      return { ...node.draft, model: idOf(node.ref.model, true, nameOf(nodes.get(node.ref.model))) };
    }
    if (!node.ref.harness) throw new Error(`${nameOf(node)}: 하네스 노드를 연결하세요.`);
    return { ...node.draft, harness: idOf(node.ref.harness, true, nameOf(nodes.get(node.ref.harness))) };
  }
  async function saveNode(node, { batch } = {}) {
    if (!isDirty(node)) return;
    for (const key of Object.values(node.ref)) {
      const target = nodes.get(key);
      if (target?.isNew) await saveNode(target, { batch: true });
    }
    const previous = node.record?.version;
    const owner = ownerOf(node);
    const saved = await request("definitions", {}, { scope: owner.scope, project: owner.project ?? undefined, team: owner.team ?? undefined,
      kind: node.kind, payload: payloadOf(node), id: node.record?.id, version: node.record?.version });
    node.record = saved;
    node.draft = structuredClone(saved.payload);
    rekey(node, "def:" + saved.id);
    S.defs = [...S.defs.filter(({ id }) => id !== saved.id), saved];
    node.isNew = false;
    delete node.owner;
    delete node.raw;
    delete node.errors;
    node.initial = fingerprint(node);
    remember(node);
    saveLayout();
    // 이전 최신 버전에 고정돼 있던 Workflow 단계는 새 버전을 따라간다(Workflow 저장 전까지는 초안).
    let bumped = 0;
    for (const step of steps()) {
      if (step.ref[node.kind] !== node.key) continue;
      if ((step.version ?? previous) === previous) {
        step.version = node.record.version;
        bumped++;
      }
    }
    if (!batch) {
      render();
      reinspect();
      say(`${nameOf(node)} · v${node.record.version} 저장됨` + (bumped ? ` · Workflow 단계 ${bumped}개가 새 버전을 쓰도록 바뀌었습니다(Workflow 저장 필요).` : ""), "ok");
      notifyChanged?.();
    }
  }
  async function saveAll() {
    if (S.busy) return;
    S.busy = true;
    el("save").disabled = true;
    try {
      const queue = libraryNodes().filter(isDirty).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      let count = 0;
      for (const node of queue) {
        if (!isDirty(node)) continue;
        await saveNode(node, { batch: true });
        count++;
      }
      let message = count ? `정의 ${count}개 저장` : "";
      if (workflowDirty()) {
        const saved = await saveWorkflow(true);
        message += (message ? " · " : "") + `Workflow ‘${saved.name}’ v${saved.version} 저장`;
      }
      render();
      if (count) reinspect();
      say(message ? message + "됨" : "저장할 변경이 없습니다.", message ? "ok" : "");
      if (count) notifyChanged?.();
    } finally {
      S.busy = false;
      updateToolbar();
    }
  }
  async function saveWorkflow(batch) {
    if (!S.project) throw new Error("작업 프로젝트를 선택하세요.");
    if (!workflowName.value.trim()) { workflowName.focus(); throw new Error("Workflow 이름을 입력하세요."); }
    const owner = S.project.id;
    // 저장 범위는 새 Workflow 를 처음 저장할 때만 고른다(서버가 이후 변경을 막는다).
    const scope = S.wf.record ? undefined : el("workflow-scope").value;
    if (scope === "team" && !S.project.team) throw new Error("이 프로젝트에는 팀이 없습니다. 프로젝트 범위나 개인 범위로 저장하세요.");
    const saved = await request("workflows", {}, { project: owner, payload: serialize(true), id: S.wf.record?.id, version: S.wf.record?.version, scope });
    if (owner !== S.project?.id) return saved;
    await loadWorkflows();
    const before = spots();
    openDocument(saved, saved.payload);
    if (spots() !== before) Object.assign(spots(), before);
    fillWorkflowPicker(saved.id);
    if (!batch) { render(); say(`Workflow ‘${saved.name}’ v${saved.version} 저장됨`, "ok"); }
    notifyChanged?.();
    return saved;
  }
  function revert(node) {
    if (node.isNew) return;
    const fresh = libraryNode(node.kind, node.record, node.record.payload);
    Object.assign(fresh, { x: node.x, y: node.y, collapsed: node.collapsed });
    nodes.set(node.key, fresh);
    render();
    say(`${nameOf(fresh)}을(를) 저장된 v${fresh.record.version}으로 되돌렸습니다.`);
  }
  async function removeNode(node) {
    if (node.kind === "step") {
      const id = node.data.id;
      S.wf.edges = S.wf.edges.filter(({ from, to }) => from !== id && to !== id);
      for (const step of steps()) if (step.data.source === id) step.data.source = "";
      nodes.delete(node.key);
      render();
      say(`${nameOf(node)} 단계를 지웠습니다. Workflow를 저장해야 반영됩니다.`);
      return;
    }
    const users = [...nodes.values()].filter((other) => Object.values(other.ref).includes(node.key));
    if (!node.isNew) {
      if (!window.confirm(`‘${nameOf(node)}’ ${KIND_LABELS[node.kind]}을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
      try {
        await request("definitions/remove", {}, { id: node.record.id });
      } catch (error) {
        throw new Error(/referenced/i.test(error.message) ? "다른 정의나 Workflow가 이 정의를 쓰고 있어 삭제할 수 없습니다. 먼저 연결을 바꿔 저장하세요." : error.message);
      }
      S.historyClear();   // 서버에서 지운 정의는 되돌릴 수 없다
      S.defs = S.defs.filter(({ id }) => id !== node.record.id);
      notifyChanged?.();
    }
    for (const other of users) for (const [slot, value] of Object.entries(other.ref)) if (value === node.key) other.ref[slot] = "";
    nodes.delete(node.key);
    pinned.delete(node.key);
    delete spots()[node.key];
    saveLayout();
    render();
    say(`${nameOf(node)}을(를) 삭제했습니다.` + (users.length ? ` 연결 ${users.length}개를 해제했습니다.` : ""));
  }

  return { payloadOf, rekey, removeNode, revert, saveAll, saveNode, saveWorkflow };
}
