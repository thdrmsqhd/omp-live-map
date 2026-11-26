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
  const visible = mapMode === "map";
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
function inboxSessionId(key) { return liveNodeId(key) || key; }
function paintInboxAsks() {
  paintInboxButton();
  if (wfQueuePanel.hidden) return;
  const groups = [...ASKS].filter(([, list]) => list.length);
  const html = groups.map(([key, list]) => {
    const id = inboxSessionId(key), node = typeof nodeById === "function" ? nodeById(id) : null;
    const title = node ? attnTitle(node) : key.split("/").pop();
    return `<section class="inbox-ask" data-ask-node="${esc(id)}">
      <div class="inbox-ask-h"><strong>${esc(title)}</strong>${node ? `<button type="button" class="inbox-open" data-open-node="${esc(id)}">카드 열기</button>` : ""}</div>
      <div class="casks">${list.map(askCardHTML).join("")}</div></section>`;
  }).join("") || `<p>답을 기다리는 질문이 없습니다.</p>`;
  if (inboxAsks.__html !== html) {
    const active = document.activeElement;
    const focus = active && inboxAsks.contains(active) && active.dataset?.askField
      ? { node: active.closest("[data-ask-node]")?.dataset.askNode, card: active.closest("[data-ask-card]")?.dataset.askCard, field: active.dataset.askField } : null;
    inboxAsks.__html = html;
    inboxAsks.innerHTML = html;
    if (focus) inboxAsks.querySelector(`[data-ask-node="${CSS.escape(focus.node ?? "")}"] [data-ask-card="${focus.card}"] [data-ask-field="${focus.field}"]`)?.focus();
  }
  for (const section of inboxAsks.querySelectorAll("[data-ask-node]")) syncAskFields(section, asksOf(section.dataset.askNode));
  if (typeof updateAskDeadlines === "function") updateAskDeadlines(inboxAsks);
}
const inboxHit = (element) => {
  const section = element.closest("[data-ask-node]"), card = element.closest("[data-ask-card]");
  const r = section && card ? asksOf(section.dataset.askNode)[+card.dataset.askCard] : null;
  return r ? { id: section.dataset.askNode, r } : null;
};
// 고른 항목·오류 표시는 대화 블록만 다시 그리므로(paintChat) 함도 한 번 더 그린다.
const inboxLater = () => setTimeout(paintInboxAsks, 0);
inboxAsks.addEventListener("change", (event) => {
  const hit = inboxHit(event.target);
  if (!hit) return;
  if (event.target.dataset.askOpt != null) askPick(hit.id, hit.r.id, +event.target.dataset.askOpt, event.target.dataset.askLabel);
  else if (event.target.dataset.askSel != null) askSelect(hit.id, hit.r.id, +event.target.dataset.askSel);
  inboxLater();
});
inboxAsks.addEventListener("input", (event) => {
  const hit = inboxHit(event.target);
  if (!hit) return;
  if (event.target.dataset.askCustom != null) askCustom(hit.id, hit.r.id, +event.target.dataset.askCustom, event.target.value);
  else if (event.target.dataset.askValue != null) askValue(hit.id, hit.r.id, event.target.value);
});
inboxAsks.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  const hit = inboxHit(event.target);
  if (!hit) return;
  event.preventDefault();
  if (hit.r.method === "confirm") askConfirm(hit.id, hit.r.id, true); else askSend(hit.id, hit.r.id);
  inboxLater();
});
inboxAsks.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-node]");
  if (open) {
    if (typeof openNode === "function") openNode(open.dataset.openNode);
    setWorkflowQueueOpen(false);
    return;
  }
  const button = event.target.closest("button"), hit = inboxHit(event.target);
  if (!button || !hit) return;
  if (button.dataset.askSend != null) askSend(hit.id, hit.r.id);
  else if (button.dataset.askCancel != null) askCancel(hit.id, hit.r.id);
  else if (button.dataset.askConfirm != null) askConfirm(hit.id, hit.r.id, button.dataset.askConfirm === "1");
  inboxLater();
});
// 질문이 생기거나 풀리면(SSE) 함과 버튼 숫자를 바로 고친다.
{
  const touched = askTouched;
  askTouched = (node) => { touched(node); paintInboxAsks(); };
  // 답 보내기 실패 같은 표시는 대화 블록(paintChat)만 다시 그리므로 함이 열려 있으면 함도 다시 그린다.
  const chat = paintChat;
  paintChat = (id) => { chat(id); if (!wfQueuePanel.hidden) paintInboxAsks(); };
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
  if (attention && item.status === "waiting_approval" && item.node) {
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
  if (!window.engineeringDesktop || mapMode !== "map" || document.hidden) return;
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
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "i" && mapMode === "map") {
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
