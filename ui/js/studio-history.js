// 노드 캔버스의 되돌리기·다시 실행. 저장하기 전의 캔버스 편집(노드 추가·삭제, 연결, 이동, 값 변경)만 다룬다.
// 서버에 반영된 일(저장, 저장된 정의 삭제)과 Workflow·프로젝트 전환은 이력을 비운다.
// 조작이 시작될 때 상태를 찍어 두고, 끝났을 때 달라졌으면 그 상태를 이력에 넣는다.
const LIMIT = 100;

export function bindStudioHistory(S) {
  const { nodes, workflowName } = S;
  const undoStack = [], redoStack = [];
  let pending = null;

  const libraryFields = (node) => ({ draft: node.draft, ref: node.ref, owner: node.owner ?? null, x: node.x, y: node.y, collapsed: node.collapsed, isNew: node.isNew });
  const stepFields = (node) => ({ data: node.data, ref: node.ref, x: node.x, y: node.y, collapsed: node.collapsed, version: node.version,
    profileVersion: node.profileVersion, profileSpot: node.profileSpot });

  function snapshot() {
    return {
      record: S.wf?.record ?? null,
      entries: [...nodes.values()].map((node) => [node, structuredClone(node.kind === "step" ? stepFields(node) : libraryFields(node))]),
      edges: S.wf ? structuredClone(S.wf.edges) : null,
      name: workflowName.value,
    };
  }
  const fingerprint = (state) => JSON.stringify([state.entries.map(([node, fields]) => [node.key, fields]), state.edges, state.name]);

  function restore(state) {
    nodes.clear();
    for (const [node, fields] of state.entries) {
      Object.assign(node, structuredClone(fields));
      if (fields.owner === null) delete node.owner;
      nodes.set(node.key, node);
    }
    if (S.wf && state.edges) S.wf.edges = structuredClone(state.edges);
    workflowName.value = state.name;
    S.render();
  }

  // 조작 시작. 앞 조작이 남긴 변화가 있으면 먼저 이력에 넣는다.
  function begin() {
    commit();
    pending = snapshot();
  }
  function commit() {
    if (!pending) return;
    const before = pending;
    pending = null;
    if (before.record !== (S.wf?.record ?? null) || fingerprint(before) === fingerprint(snapshot())) return;
    undoStack.push(before);
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack.length = 0;
    S.updateToolbar();
  }
  function step(from, to, label) {
    commit();
    const state = from.pop();
    if (!state) return false;
    to.push(snapshot());
    restore(state);
    S.say(label);
    return true;
  }
  return {
    begin, commit,
    undo: () => step(undoStack, redoStack, "편집을 되돌렸습니다. 저장하기 전까지만 되돌릴 수 있습니다."),
    redo: () => step(redoStack, undoStack, "되돌린 편집을 다시 적용했습니다."),
    clear() { undoStack.length = 0; redoStack.length = 0; pending = null; },
    canUndo: () => undoStack.length > 0 || Boolean(pending && fingerprint(pending) !== fingerprint(snapshot())),
    canRedo: () => redoStack.length > 0,
  };
}
