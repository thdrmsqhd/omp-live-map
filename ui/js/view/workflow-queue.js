/* Live Map에서 캔버스를 열어 둔 채 개입이 필요한 실행을 찾는다. */
const wfQueueButton = $("workflow-queue-toggle");
const wfQueuePanel = $("workflow-queue");
const wfQueueStatus = $("workflow-queue-status");
const wfQueueItems = $("workflow-queue-items");
let wfQueueLoading = false, wfQueueAgain = false, wfQueueSignature;

function setWorkflowQueueOpen(open) {
  wfQueuePanel.hidden = !open;
  wfQueueButton.setAttribute("aria-expanded", String(open));
}

function paintWorkflowQueueMode() {
  const visible = Boolean(window.engineeringDesktop) && mapMode === "map";
  wfQueueButton.hidden = !visible;
  if (!visible) setWorkflowQueueOpen(false);
}

function paintWorkflowQueue({ total, attention, recent }) {
  const signature = JSON.stringify([total, attention, recent]);
  if (signature === wfQueueSignature) return;
  wfQueueSignature = signature;
  wfQueueButton.textContent = "개입 필요 " + total;
  const focused = document.activeElement?.closest("[data-queue-run]");
  const sections = [
    ["개입 필요", attention, "개입이 필요한 실행이 없습니다."],
    ["최근 실행", recent, "최근 실행이 없습니다."],
  ].map(([title, items, empty]) => {
    const section = document.createElement("section");
    section.append(wfText("h3", title));
    for (const item of items) {
      const button = wfText("button", "");
      button.type = "button";
      button.dataset.queueRun = item.id;
      button.dataset.status = item.status;
      if (item.node) button.dataset.queueNode = item.node;
      button.append(wfText("strong", item.title), wfText("small", item.project + " · " + wfLabel(item.status)));
      section.append(button);
    }
    if (!items.length) section.append(wfText("p", empty));
    if (items === attention && total > attention.length) {
      section.append(wfText("p", total + "건 중 " + attention.length + "건 표시"));
    }
    return section;
  });
  wfQueueItems.replaceChildren(...sections);
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

if (window.engineeringDesktop) {
  renderWorkflowQueueMode = paintWorkflowQueueMode;
  paintWorkflowQueueMode();
  wfQueueButton.onclick = () => {
    setWorkflowQueueOpen(wfQueuePanel.hidden);
    if (!wfQueuePanel.hidden) void refreshWorkflowQueue();
  };
  wfQueuePanel.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-queue-run]");
    if (!button) return;
    const opened = await openMapWorkflow(button.dataset.queueRun, button.dataset.queueNode);
    if (opened) {
      setWorkflowQueueOpen(false);
      $("wf-map-title").focus({ preventScroll: true });
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || wfQueuePanel.hidden || $("workflow-launch").open) return;
    setWorkflowQueueOpen(false);
    wfQueueButton.focus();
  });
  document.addEventListener("visibilitychange", refreshWorkflowQueue);
  setInterval(refreshWorkflowQueue, 5000);
  void refreshWorkflowQueue();
}
