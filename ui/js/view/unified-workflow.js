/* Embed the existing desktop execution controls in the editable studio. */
(() => {
  'use strict';
  const inspector = $('workflow-inspector'), queue = $('workflow-queue'), stage = $('stage');
  const steps = $('unified-run-steps'), snapshot = $('unified-run-snapshot'), cards = $('studio-nodes');
  const getCard = id => cards.querySelector(`.studio-node[data-key="${CSS.escape('step:' + id)}"]`);
  function choose(id) {
    if (!wfMap.run?.graph.nodes.some(n => n.id === id)) return;
    wfStopFollow();
    wfMap.selected = id;
    writeJSON('omp-workflow-map-selection', { id: wfMap.run.run.id, node: id });
    paintWorkflowMap();
    $('unified-journal').scrollIntoView({ block: 'nearest' });
  }
  function focus(id) {
    const card = getCard(id);
    if (!snapshot.hidden) {
      steps.querySelector(`[data-step="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (!card) return false;
    return window.ompDesign?.focusStep(id) || false;
  }
  function mount(mode) {
    if (mode === 'design') {
      $('unified-inspector-host').append(inspector);
      $('unified-queue-host').append(queue);
      void refreshWorkflowQueue();
    } else {
      stage.append(queue, inspector);
      for (const [id, bar] of wfActionBars) { $('workflow-map-nodes').append(bar); wfPlaceNodeActions(id); }
    }
    paint();
  }
  function askSession(detail, node, status) {
    if (detail !== wfMap.run) return null;
    return workflowMonitorAskKey(detail, node, status);
  }
  function runtimeAsk(state, node, key) {
    let host = state.querySelector(':scope > .unified-node-ask');
    const list = key ? asksOf(key) : [];
    if (host && (!list.length || host.dataset.askNode !== key)) { host.remove(); host = null; }
    if (!list.length) return;
    if (!host) {
      host = wfText('section', '', 'unified-node-ask');
      host.dataset.askNode = key;
      host.dataset.workflowControls = '';
      host.setAttribute('aria-label', '에이전트 질문');
      const form = wfText('form', '', 'casks');
      host.append(wfText('strong', '에이전트 질문 · 답변 대기'), form);
      for (const type of ['pointerdown', 'wheel', 'dblclick']) host.addEventListener(type, e => e.stopPropagation());
      bindWorkflowAskControls(host, id => {
        const detail = wfMap.run;
        return host.isConnected && detail && detail.graph.nodes.some(n => n.id === node.id && n.type === node.type)
          && id === askSession(detail, node, detail.nodes.find(n => n.node === node.id)?.status);
      });
      state.append(host);
    }
    const form = host.querySelector('.casks');
    const ids = JSON.stringify(list.map(r => r.id));
    if (form.dataset.requestIds !== ids) {
      // Do not restore focus by array position when a question has been removed/replaced.
      if (form.contains(document.activeElement)) document.activeElement.blur();
      form.dataset.requestIds = ids;
      delete form.__html;
    }
    paintChatAsk(host, key);
    trackWorkflowAskCards(form, key, list);
  }
  function runtimeCard(card, node, status) {
    card.dataset.runtimeStatus = status;
    const state = card.querySelector(':scope > .unified-node-state') || (() => {
      const box = wfText('div', '', 'unified-node-state');
      const button = wfActionButton('', () => choose(node.id));
      button.addEventListener('pointerdown', e => e.stopPropagation());
      box.append(button); card.append(box); return box;
    })();
    state.firstChild.textContent = wfLabel(status) + ' · 수행 내역';
    state.firstChild.setAttribute('aria-pressed', String(wfMap.selected === node.id));
    const bar = wfActionBars.get(node.id);
    if (bar && bar.parentElement !== state) state.append(bar);
    runtimeAsk(state, node, askSession(wfMap.run, node, status));
    const live = wfMap.run.live?.[node.id];
    let stream = state.querySelector('.unified-node-preview');
    if (live?.text && status === 'running') {
      if (!stream) { stream = wfText('pre', '', 'unified-node-preview'); state.append(stream); }
      const text = live.text.trim().slice(-380);
      if (stream.textContent !== text) stream.textContent = text;
    } else stream?.remove();
  }
  function paint() {
    if (mapMode !== 'design') return;
    const detail = wfMap.edit ? null : wfMap.run;
    const matches = detail && window.ompDesign?.matches(detail.run);
    $('unified-empty-run').hidden = !!detail || wfMap.opening;
    snapshot.hidden = !detail || !!matches;
    if (!detail && !wfMap.opening) inspector.hidden = true;
    const graph = detail?.graph.nodes.filter(n => n.type !== 'profile') || [];
    const current = new Map(graph.map(n => [n.id, n]));
    const state = new Map((detail?.nodes || []).map(n => [n.node, n.status]));
    for (const card of cards.querySelectorAll('[data-runtime-status]')) {
      if (matches && current.has(card.dataset.key?.slice(5))) continue;
      const runtime = card.querySelector(':scope > .unified-node-state');
      if (runtime) for (const bar of runtime.querySelectorAll('.wf-node-actions')) $('workflow-map-nodes').append(bar);
      runtime?.remove(); delete card.dataset.runtimeStatus;
    }
    if (matches) for (const node of graph) { const card = getCard(node.id); if (card) runtimeCard(card, node, state.get(node.id) || 'queued'); }
    const key = snapshot.hidden ? '' : `${detail.run.id}:${detail.run.version}`;
    if (steps.dataset.key !== key) {
      steps.dataset.key = key;
      steps.replaceChildren(...(key ? graph.map(node => {
        const card = wfText('article', '', 'unified-snapshot-card'); card.dataset.step = node.id;
        card.append(wfText('h3', node.label), wfText('p', node.instruction || node.prompt || wfTypeNames[node.type] || node.type));
        return card;
      }) : []));
    }
    if (key) for (const card of steps.children) runtimeCard(card, current.get(card.dataset.step), state.get(card.dataset.step) || 'queued');
  }
  new MutationObserver(paint).observe(cards, { childList: true });
  cards.addEventListener('click', event => {
    if (event.target.closest('button, select, input, textarea, label, .studio-socket, .unified-node-state')) return;
    const card = event.target.closest('[data-runtime-status]');
    if (!card) return;
    const id = card.dataset.key.slice(5);
    if (wfMap.selected !== id) { wfMap.selected = id; wfStopFollow(); paintWorkflowMap(); }
  });
  document.addEventListener('omp-mode', event => mount(event.detail));
  mount(mapMode);
  window.UnifiedWorkflow = { paint, focus, paintAsk(key) {
    if (mapMode === 'design' && Object.values(wfMap.run?.live || {}).some(progress => progress?.askSession === key)) paint();
  } };
})();
