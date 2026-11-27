/* Workflow 관제에서 실행 상태와 질문 소유를 고른다. DOM 은 만들지 않는다. */

const WORKFLOW_ASK_KEY = /^workflow-ask:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isWorkflowAskSession(key) {
  return typeof key === "string" && WORKFLOW_ASK_KEY.test(key);
}

function inboxSessionId(key) {
  const id = typeof liveNodeId === "function" ? liveNodeId(key) : "";
  if (id) return id;
  if (typeof ATTN !== "undefined" && ATTN && typeof askKey === "function") {
    for (const node of ATTN.keys()) if (askKey(node) === key) return node;
  }
  return key;
}

function inboxAskGroups() {
  if (typeof ASKS === "undefined" || !ASKS) return [];
  const groups = [];
  for (const [key, list] of ASKS) {
    if (!list || !list.length) continue;
    const id = inboxSessionId(key);
    const node = typeof nodeById === "function" ? nodeById(id) : null;
    const titled = node && typeof attnTitle === "function" ? attnTitle(node) : "";
    const stored = typeof ATTN !== "undefined" && ATTN ? ATTN.get(id)?.title : "";
    const title = titled || stored || (isWorkflowAskSession(key) ? "Workflow 에이전트" : String(key).split("/").pop());
    groups.push({ key, id, list, node, title });
  }
  return groups;
}

// 같은 질문 키를 두 단계가 나누면 어느 카드도 소유하지 않는다.
function workflowMonitorAskKey(detail, node, status, editing = false) {
  if (mapMode !== "design" || editing) return null;
  if (!detail || detail.run.status !== "running" || status !== "running") return null;
  if (!node || !["agent", "loop"].includes(node.type)) return null;
  const key = detail.live?.[node.id]?.askSession;
  if (!isWorkflowAskSession(key)) return null;
  const owners = Object.values(detail.live || {}).filter((progress) => progress?.askSession === key).length;
  return owners === 1 ? key : null;
}
