/* Live Map 의 '개입 필요' 함. 사람이 답해야 하는 일을 한곳에 모아 그 자리에서 처리한다.
   - 에이전트 질문: 세션(OMP·Claude Code)이 묻는 ask·select·confirm·input·editor 를 카드를 열지 않고 답한다
     (질문 카드 마크업·답 보내기는 chat-ask.js 와 같은 것을 쓴다).
   - Workflow: 승인 대기는 승인 안내를 보고 바로 승인·반려하고, 실패·확인 필요는 실행을 연다(데스크톱 앱에서만).
   단축키 Alt+I 로 열고 닫는다. */
const wfQueueButton = $("workflow-queue-toggle");
const wfQueuePanel = $("workflow-queue");
const wfQueueStatus = $("workflow-queue-status");
const wfQueueItems = $("workflow-queue-items");
const inboxAsks = $("inbox-asks");
let wfQueueLoading = false, wfQueueAgain = false, wfQueueSignature, wfQueueTotal = 0;

function setWorkflowQueueOpen(open) {
  wfQueuePanel.hidden = !open;
  wfQueueButton.setAttribute("aria-expanded", String(open));
  if (open) paintInboxAsks();
}

function paintWorkflowQueueMode() {
  const visible = mapMode === "map" || mapMode === "design";
  wfQueueButton.hidden = !visible;
  if (!visible) setWorkflowQueueOpen(false);
}

function inboxAskCount() {
  let count = 0;
  for (const list of ASKS.values()) count += list.length;
  return count;
}
function paintInboxButton() {
  const total = wfQueueTotal + inboxAskCount();
  wfQueueButton.textContent = "개입 필요 " + total;
  wfQueueButton.classList.toggle("has-items", total > 0);
}

// ---- 에이전트 질문 -------------------------------------------------------------
// 질문 키(소문자·슬래시 경로)를 지도 노드 id 로 바꾼다. 카드가 아직 없으면 '주의 필요' 상태(ATTN)에서 찾는다.
function inboxSessionId(key) {
  const id = liveNodeId(key);
  if (id) return id;
  for (const node of ATTN.keys()) if (askKey(node) === key) return node;
  return key;
}
// 엔지니어링 런타임이 현재 RPC 에 할당한 키만 Workflow 질문의 소유권을 나타낸다.
const isWorkflowAskSession = (key) => typeof key === "string" && /^workflow-ask:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key);
const workflowAskCards = new WeakMap();
function trackWorkflowAskCards(host, id, list) {
  for (const card of host.querySelectorAll("[data-ask-card]")) {
    const request = list[+card.dataset.askCard];
    if (request) workflowAskCards.set(card, { id, request });
    for (const button of card.querySelectorAll("button")) button.type = "button";
  }
}
function paintInboxAsks() {
  paintInboxButton();
  if (wfQueuePanel.hidden) return;
  const groups = [...ASKS].filter(([, list]) => list.length);
  const html = groups.map(([key, list]) => {
    const id = inboxSessionId(key), node = typeof nodeById === "function" ? nodeById(id) : null;
    const title = node ? attnTitle(node) : ATTN.get(id)?.title || (isWorkflowAskSession(key) ? "Workflow 에이전트" : key.split("/").pop());
    return `<section class="inbox-ask" data-ask-node="${esc(id)}">
      <div class="inbox-ask-h"><strong>${esc(title)}</strong>${node ? `<button type="button" class="inbox-open" data-open-node="${esc(id)}">카드 열기</button>` : ""}</div>
      <form class="casks">${list.map(askCardHTML).join("")}</form></section>`;
  }).join("") || `<p>답을 기다리는 질문이 없습니다.</p>`;
  const signature = JSON.stringify([html, groups.map(([key, list]) => [key, list.map(r => r.id)])]);
  if (inboxAsks.__html !== signature) {
    const active = document.activeElement;
    const previous = inboxAsks.contains(active) && workflowAskCards.get(active.closest("[data-ask-card]"));
    const field = previous && active.dataset.askField;
    inboxAsks.__html = signature;
    inboxAsks.innerHTML = html;
    if (field) {
      const index = asksOf(previous.id).indexOf(previous.request);
      if (index >= 0) inboxAsks.querySelector(`[data-ask-node="${CSS.escape(previous.id)}"] [data-ask-card="${index}"] [data-ask-field="${field}"]`)?.focus();
    }
  }
  for (const section of inboxAsks.querySelectorAll("[data-ask-node]")) {
    const id = section.dataset.askNode, list = asksOf(id);
    trackWorkflowAskCards(section, id, list);
    syncAskFields(section, list);
  }
  updateAskDeadlines(inboxAsks);
}
function bindWorkflowAskControls(host, authorized = () => true) {
  const requestHit = (element) => {
    const card = element.closest("[data-ask-card]"), hit = workflowAskCards.get(card);
    return hit && host.contains(card) && authorized(hit.id) && asksOf(hit.id).includes(hit.request) ? hit : null;
  };
  const later = (node) => setTimeout(() => paintWorkflowAskSurfaces(node), 0);
  host.addEventListener("submit", event => event.preventDefault());
  host.addEventListener("change", (event) => {
    const hit = requestHit(event.target);
    if (!hit) return;
    const field = event.target.dataset;
    if (field.askOpt != null) askPick(hit.id, hit.request.id, +field.askOpt, field.askLabel);
    else if (field.askSel != null) askSelect(hit.id, hit.request.id, +field.askSel);
    later(hit.id);
  });
  host.addEventListener("input", (event) => {
    const hit = requestHit(event.target);
    if (!hit) return;
    const field = event.target.dataset;
    if (field.askCustom != null) askCustom(hit.id, hit.request.id, +field.askCustom, event.target.value);
    else if (field.askValue != null) askValue(hit.id, hit.request.id, event.target.value);
    // 입력 중인 두 화면을 같은 모델 상태에 맞추되, 포커스를 빼앗지 않는다.
    later(hit.id);
  });
  host.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
    const hit = requestHit(event.target);
    if (!hit) return;
    event.preventDefault();
    if (hit.request.method === "confirm") askConfirm(hit.id, hit.request.id, true); else askSend(hit.id, hit.request.id);
    later(hit.id);
  });
  host.addEventListener("click", (event) => {
    const button = event.target.closest("button"), hit = requestHit(event.target);
    if (!button || !hit) return;
    if (button.dataset.askSend != null) askSend(hit.id, hit.request.id);
    else if (button.dataset.askCancel != null) askCancel(hit.id, hit.request.id);
    else if (button.dataset.askConfirm != null) askConfirm(hit.id, hit.request.id, button.dataset.askConfirm === "1");
    later(hit.id);
  });
}
bindWorkflowAskControls(inboxAsks);
inboxAsks.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-node]");
  if (!open) return;
  if (typeof openNode === "function") openNode(open.dataset.openNode);
  setWorkflowQueueOpen(false);
});
// 질문 SSE 와 응답 오류를 두 위치의 같은 질문 모델에 반영한다.
function paintWorkflowAskSurfaces(node) {
  paintInboxAsks();
  if (isWorkflowAskSession(node)) window.UnifiedWorkflow?.paintAsk(node);
}
{
  const touched = askTouched;
  askTouched = (node) => { touched(node); paintWorkflowAskSurfaces(node); };
  const chat = paintChat;
  paintChat = (id) => { chat(id); if (!wfQueuePanel.hidden || isWorkflowAskSession(id)) paintWorkflowAskSurfaces(id); };
}

// ---- Workflow -----------------------------------------------------------------
async function inboxDecide(button, item, decision, memo, status) {
  if (decision === "rejected" && !memo.value.trim()) { status.textContent = "반려 사유를 입력해 주세요."; memo.focus(); return; }
  button.disabled = true;
  status.textContent = "";
  try {
    await mapWorkflowRequest("workflow-runs/approval", {}, { id: item.id, node: item.node, decision, reason: memo.value });
    memo.value = "";
    wfQueueSignature = undefined;
    await refreshWorkflowQueue();
    if (wfMap.run?.run.id === item.id) void refreshMapWorkflow();
  } catch (error) { status.textContent = error.message; button.disabled = false; }
}

function workflowItem(item, attention) {
  const article = document.createElement("article");
  article.className = "inbox-run";
  article.dataset.status = item.status;
  const open = wfText("button", "", "inbox-run-open");
  open.type = "button";
  open.dataset.queueRun = item.id;
  if (item.node) open.dataset.queueNode = item.node;
  open.append(wfText("strong", item.title), wfText("small", item.project + " · " + wfLabel(item.status)));
  article.append(open);
  if (attention && item.status === "waiting_approval" && item.node && item.gate) {
    article.append(wfText("p", "원래 창에서 직접 처리한 뒤 진행 상태만 기록하세요."));
    const status = wfText("small", "", "inbox-run-status");
    status.setAttribute("role", "status");
    const row = wfText("div", "", "wf-node-actions-row");
    for (const [decision, label] of [["approved", "직접 처리 완료"], ["rejected", "진행하지 않음"]]) {
      const button = wfText("button", label);
      button.type = "button";
      button.onclick = () => void inboxDecide(button, item, decision, { value: "manual" }, status);
      row.append(button);
    }
    article.append(row, status);
  } else if (attention && item.status === "waiting_approval" && item.node && !item.gate) {
    if (item.prompt) article.append(wfText("p", item.prompt, "inbox-run-prompt"));
    const memo = document.createElement("textarea");
    memo.rows = 2;
    memo.maxLength = 2000;
    memo.placeholder = "승인 메모(선택) · 반려 사유(필수)";
    memo.setAttribute("aria-label", item.title + " 승인 메모 또는 반려 사유");
    const status = wfText("small", "", "inbox-run-status");
    status.setAttribute("role", "status");
    const row = wfText("div", "", "wf-node-actions-row");
    for (const [decision, label] of [["approved", "승인"], ["rejected", "반려"]]) {
      const button = wfText("button", label);
      button.type = "button";
      button.dataset.decision = decision;
      button.onclick = () => void inboxDecide(button, item, decision, memo, status);
      row.append(button);
    }
    memo.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); row.firstChild.click(); }
    });
    article.append(memo, row, status);
  }
  return article;
}

function paintWorkflowQueue({ total, attention, recent }) {
  const signature = JSON.stringify([total, attention, recent]);
  if (signature === wfQueueSignature) return;
  // 승인 메모를 쓰는 중이면 다시 그리지 않는다(다음 갱신에 반영).
  const active = document.activeElement;
  if (wfQueueItems.contains(active) && active.tagName === "TEXTAREA" && active.value) return;
  wfQueueSignature = signature;
  wfQueueTotal = total;
  paintInboxButton();
  const focused = active?.closest?.("[data-queue-run]");
  const approvals = document.createElement("section");
  approvals.append(wfText("h3", "Workflow 승인·확인"), ...attention.map((item) => workflowItem(item, true)));
  if (!attention.length) approvals.append(wfText("p", "개입이 필요한 Workflow 실행이 없습니다."));
  if (total > attention.length) approvals.append(wfText("p", total + "건 중 " + attention.length + "건 표시"));
  const history = document.createElement("details");
  history.append(wfText("summary", "최근 실행 " + recent.length), ...recent.map((item) => workflowItem(item, false)));
  if (!recent.length) history.append(wfText("p", "최근 실행이 없습니다."));
  wfQueueItems.replaceChildren(approvals, history);
  if (focused && !focused.isConnected) {
    const next = Array.from(wfQueueItems.querySelectorAll("[data-queue-run]"))
      .find((button) => button.dataset.queueRun === focused.dataset.queueRun);
    (next ?? wfQueueButton).focus({ preventScroll: true });
  }
}

async function refreshWorkflowQueue() {
  if (!window.engineeringDesktop || !["map", "design"].includes(mapMode) || document.hidden) return;
  if (wfQueueLoading) { wfQueueAgain = true; return; }
  wfQueueLoading = true;
  if (!wfQueueSignature) wfQueueStatus.textContent = "실행 목록을 불러오는 중입니다.";
  try {
    paintWorkflowQueue(await mapWorkflowRequest("workflow-live-map"));
    wfQueueStatus.textContent = "";
  } catch (error) {
    wfQueueStatus.textContent = "실행 목록 갱신 실패 · " + error.message;
  } finally {
    wfQueueLoading = false;
    if (wfQueueAgain) { wfQueueAgain = false; void refreshWorkflowQueue(); }
  }
}

renderWorkflowQueueMode = paintWorkflowQueueMode;
paintWorkflowQueueMode();
paintInboxButton();
$("workflow-queue-workflows").hidden = !window.engineeringDesktop;
wfQueueButton.onclick = () => {
  setWorkflowQueueOpen(wfQueuePanel.hidden);
  if (!wfQueuePanel.hidden) void refreshWorkflowQueue();
};
wfQueueItems.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-queue-run]");
  if (!button) return;
  const opened = await openMapWorkflow(button.dataset.queueRun, button.dataset.queueNode);
  if (opened) {
    setWorkflowQueueOpen(false);
    $("wf-map-title").focus({ preventScroll: true });
  }
});
document.addEventListener("keydown", (event) => {
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "i" && ["map", "design"].includes(mapMode)) {
    event.preventDefault();
    wfQueueButton.click();
    if (!wfQueuePanel.hidden) wfQueuePanel.querySelector("textarea, input, button")?.focus({ preventScroll: true });
    return;
  }
  if (event.key !== "Escape" || wfQueuePanel.hidden || $("workflow-launch").open) return;
  setWorkflowQueueOpen(false);
  wfQueueButton.focus();
});
if (window.engineeringDesktop) {
  document.addEventListener("visibilitychange", refreshWorkflowQueue);
  setInterval(refreshWorkflowQueue, 5000);
  void refreshWorkflowQueue();
}
