(function () {
  'use strict';
  const M = globalThis.WORKSPACE_MODEL, C = globalThis.WORKSPACE_CATALOG;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const storageKey = 'omp.unified-workspace.prototype.v1';
  const nodeKinds = ['프로필', '루프', 'Workflow'];
  const glyph = { '프로필': '◉', '루프': '↻', Workflow: '⌘', search: '⌕', answer: '▤', evaluation: '◇' };
  let graph = M.clone(M.defaultGraph), run = M.initialRun(), dirty = false, drawFrame, lastOpener;
  let docs = M.clone(M.exampleDocs), docHandles = [], docMode = 'sample', docsUpdated = null, docRevision = 0, docRefreshBusy = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.version === 1 && Array.isArray(saved.nodes) && Array.isArray(saved.edges) && !M.validate(saved).error) {
      graph = saved;
      if (JSON.stringify(graph) !== JSON.stringify(M.defaultGraph)) run = null;
    }
  } catch { /* missing or unavailable browser storage */ }
  const active = () => ['ready', 'running', 'waiting'].includes(run?.phase);
  const def = id => graph.nodes.find(n => n.id === id);
  const val = (n, k) => esc(M.field(n, k));
  const chip = (text, type = '') => `<span class="chip ${type}">${esc(text)}</span>`;
  const uid = () => `n-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  function notice(text = '') { $('notice').hidden = !text; $('notice').textContent = text; }
  function changed(text) { dirty = true; notice(text); render(); }
  function render() {
    const previousInput = $('intervention-input');
    const previousText = previousInput?.dataset.node === run?.pending?.nodeId ? previousInput?.value : '';
    const list = M.harnesses(graph), order = M.validate(graph).order || list;
    const flow = order.filter(n => n.type !== 'evaluation'), external = list.filter(n => n.type === 'evaluation');
    $('save-btn').textContent = dirty ? '설계 저장 ·' : '설계 저장';
    $('run-btn').disabled = active() && !(run.id === 'SIM-014' && run.phase === 'waiting' && run.entries.length === 3);
    $('connect-btn').disabled = list.length < 2 || !flow.length;
    const done = Object.values(run?.statuses || {}).filter(s => s === 'done').length;
    const phase = run?.phase || 'idle';
    $('run-indicator').innerHTML = `<span class="pulse ${phase}"></span><div><strong>${esc(run?.task || M.selectedTask(graph)?.name || '작업 미지정')}</strong><small>${esc(run?.id || '설계 초안')} · ${esc(M.statusText[phase])}</small></div>`;
    $('run-progress').innerHTML = `<progress value="${done}" max="${run?.order.length || 1}" aria-label="작업 진행률"></progress><span>${done} / ${run?.order.length || 0} 단계 완료</span>`;
    $('jump-intervention').disabled = !run?.pending;
    $('jump-intervention').textContent = run?.pending ? `개입 요청 1 · ${run.pending.kind}` : '개입 요청 0';
    $('definitions').innerHTML = graph.nodes.filter(n => n.kind !== '하네스').map(n => `<article class="definition" data-node="${esc(n.id)}"><div class="definition-head"><span class="node-icon" aria-hidden="true">${glyph[n.kind] || '□'}</span><span>${esc(n.kind)}</span><button aria-label="${esc(n.name)} 편집" data-edit="${esc(n.id)}" class="icon-button" type="button">↗</button></div><strong>${esc(n.name)}</strong><span class="definition-value">${esc(n.value)}${n.kind === '루프' ? ` · 최대 ${esc(n.limit)}회` : ''}</span>${n.kind === 'Workflow' ? `<span class="definition-value">${[def(n.profileId)?.name, def(n.loopId)?.name].filter(Boolean).map(esc).join(' · ')}</span>${M.selectedTask(graph)?.id === n.id ? chip('실행 대상') : `<button class="text-button" type="button" data-select-task="${esc(n.id)}">실행 대상으로 지정</button>`}` : ''}</article>`).join('');
    $('flow-nodes').innerHTML = flow.map((n, i) => renderCard(n, i)).join('') || '<p class="empty">노드 추가에서 실행 하네스를 배치하세요.</p>';
    if (previousText && $('intervention-input')) $('intervention-input').value = previousText;
    $('external').hidden = external.length === 0;
    $('external').innerHTML = external.length ? `<div class="external-heading"><span>◇ &nbsp; 독립 평가 레인</span><small>실행 흐름 외부 · 산출물 관찰 전용</small></div><div class="flow-nodes">${external.map((n, i) => renderCard(n, i)).join('')}</div>` : '';
    $('contract-count').textContent = `${graph.edges.length}개`;
    $('contract-list').innerHTML = graph.edges.map(e => `<li><span>${esc(def(e.from).name)} → ${esc(def(e.to).name)} <code>${esc(e.schema)}</code></span><button class="button small" type="button" data-unlink="${esc(e.from)}|${esc(e.to)}" aria-label="${esc(def(e.from).name)}에서 ${esc(def(e.to).name)} 연결 해제">해제</button></li>`).join('') || '<li class="muted">연결된 노드가 없습니다.</li>';
    renderJournal(); requestDraw();
  }
  function renderCard(n, i) {
    const state = run?.statuses[n.id] || 'ready', pending = run?.pending?.nodeId === n.id ? run.pending : null;
    return `<article class="macro ${state}" data-node="${esc(n.id)}"><div class="macro-heading"><span class="node-icon" aria-hidden="true">${glyph[n.type] || '◇'}</span><div><p class="node-meta">${n.type === 'evaluation' ? 'EXTERNAL' : `STEP ${String(i + 1).padStart(2, '0')}`} · ${esc(C.families.find(f => f.id === M.catalog[n.type].family).label)}</p><h3>${esc(n.name)}</h3></div><button class="icon-button" aria-label="${esc(n.name)} 편집" type="button" data-edit="${esc(n.id)}">↗</button></div>
      <div class="node-status">${chip(M.statusText[state], state)}${n.type === 'evaluation' ? chip('독립') : ''}${pending ? chip(pending.kind, 'waiting') : ''}</div>
      ${pending ? renderIntervention(pending) : ''}
      <dl class="io"><div><dt>입력</dt><dd>${val(n, 'input')}</dd><dd><code>${esc(n.inputSchema)}</code></dd></div><div><dt>출력</dt><dd>${val(n, 'output')}</dd><dd><code>${val(n, 'outputSchema')}</code></dd></div></dl>
      <dl class="measures"><div><dt>판단 기준</dt><dd>${val(n, 'criteria')}</dd></div><div><dt>핸드오프</dt><dd>${val(n, 'handoff') || '연결 계약에 따라 전달'}</dd></div><div><dt>중단 조건</dt><dd>${val(n, 'stop') || '별도 조건 없음'}</dd></div></dl></article>`;
  }
  function renderIntervention(p) {
    return `<section class="intervention" id="intervention" aria-labelledby="intervention-title" tabindex="-1"><h4 id="intervention-title"><span aria-hidden="true">!</span> ${esc(p.title)}</h4><p>${esc(p.prompt)}</p><div class="intervention-buttons"><button type="button" class="button small primary" data-action="approve">모의 승인</button><button type="button" class="button small" data-action="reject">반려</button></div><details${p.kind === 'ASK' ? ' open' : ''}><summary>${p.kind === 'ASK' ? 'ASK 답변 / 수정 지시' : '수정 지시'}</summary><label><span class="sr-only">민감 정보 제외 답변 또는 수정 지시</span><textarea id="intervention-input" data-node="${esc(p.nodeId)}" maxlength="400" rows="2" placeholder="민감 정보 제외 · 답변 또는 지시"></textarea></label><div class="intervention-buttons">${p.kind === 'ASK' ? '<button type="button" class="button small" data-action="answer">답변 전송</button>' : ''}<button type="button" class="button small" data-action="revise">수정 지시</button></div></details></section>`;
  }
  function renderJournal() {
    const filter = $('log-filter').value;
    const entries = (run?.entries || []).filter(e => filter === 'all' || filter === e.kind).slice().reverse();
    $('journal-body').innerHTML = `<div class="task"><span>작업 지시</span><p>${esc(run?.instruction || M.selectedTask(graph)?.value || '실행하면 여기에 수행 내역이 표시됩니다.')}</p></div><ol class="timeline">${entries.map(e => `<li><time>${esc(e.time)}</time><div>${chip(M.phases[e.kind], e.kind === 'action' ? 'waiting' : e.kind === 'artifact' ? 'done' : '')}<h3>${esc(e.title)}</h3><p>${esc(e.body)}</p>${e.nodeId && def(e.nodeId) ? `<button type="button" class="text-button" data-focus="${esc(e.nodeId)}">캔버스 노드로 이동 ↑</button>` : ''}</div></li>`).join('')}</ol>${!entries.length ? '<p class="empty">이 필터에 해당하는 수행 내역이 없습니다.</p>' : ''}`;
  }
  function requestDraw() { cancelAnimationFrame(drawFrame); drawFrame = requestAnimationFrame(drawEdges); }
  function drawEdges() {
    const host = $('graph'), svg = $('edges'), base = host.getBoundingClientRect(), ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
    svg.replaceChildren();
    const nodes = new Map(Array.from(host.querySelectorAll('article[data-node]'), el => [el.dataset.node, el.getBoundingClientRect()]));
    for (const edge of graph.edges) {
      const a = nodes.get(edge.from), b = nodes.get(edge.to);
      if (!a || !b) continue;
      const evaluation = def(edge.to).type === 'evaluation';
      const status = run?.statuses[edge.from] === 'done' && run.snapshot.edges.some(e => e.from === edge.from && e.to === edge.to && e.schema === edge.schema) ? ' delivered' : '';
      const horizontal = Math.abs(a.top - b.top) < 20 && !evaluation;
      const forward = a.left < b.left, down = a.top < b.top;
      const x1 = (horizontal ? forward ? a.right : a.left : a.left + a.width / 2) - base.left;
      const y1 = (horizontal ? a.top + 104 : down ? a.bottom : a.top) - base.top;
      const x2 = (horizontal ? forward ? b.left : b.right : b.left + b.width / 2) - base.left;
      const y2 = (horizontal ? b.top + 104 : down ? b.top : b.bottom) - base.top;
      const mid = horizontal ? (x1 + x2) / 2 : (y1 + y2) / 2;
      const route = horizontal ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} V${mid} H${x2} V${y2}`;
      const path = document.createElementNS(ns, 'path'), arrow = document.createElementNS(ns, 'path');
      for (const el of [path, arrow]) el.setAttribute('class', `edge${status}${evaluation ? ' observation' : ''}`);
      path.setAttribute('d', route);
      arrow.setAttribute('d', horizontal ? `M${x2 + (forward ? -8 : 8)},${y2 - 4} L${x2},${y2} l${forward ? -8 : 8},4` : `M${x2 - 4},${y2 + (down ? -8 : 8)} L${x2},${y2} l4,${down ? -8 : 8}`);
      svg.append(path, arrow);
      // Long labels are always available in the textual connection list; the diagram remains unobstructed.
      const label = document.createElementNS(ns, 'text');
      label.textContent = edge.schema.length > 18 ? edge.schema.slice(0, 16) + '…' : edge.schema;
      label.setAttribute('x', horizontal ? mid : (x1 + x2) / 2); label.setAttribute('y', horizontal ? y1 - 10 : mid - 7);
      const title = document.createElementNS(ns, 'title'); title.textContent = edge.schema; path.append(title); svg.append(label);
    }
  }
  function openDrawer(kicker, title, html, opener) {
    if (!$('drawer').open) lastOpener = opener || document.activeElement;
    $('drawer-kicker').textContent = kicker;
    $('drawer-title').textContent = title;
    $('drawer-body').innerHTML = `<p class="drawer-error" id="drawer-error" role="alert" hidden></p>${html}`;
    $('drawer').scrollTop = 0;
    if (!$('drawer').open) $('drawer').showModal();
    $('drawer-body').querySelector('input,select,button')?.focus();
  }
  function drawerError(error) { $('drawer-error').hidden = !error; $('drawer-error').textContent = error || ''; }
  function addPanel(opener) {
    openDrawer('NODE LIBRARY / 18 TYPES', '노드 추가', `<p class="muted">핵심 엔티티 또는 결과물·판단 기준에 맞는 하네스를 선택하세요.</p><label class="stack">하네스 검색 <input id="catalog-search" type="search" placeholder="예: 평가, 문서, UAC"></label><div id="catalog"></div>`, opener);
    function drawCatalog() {
      const q = $('catalog-search').value.trim().toLowerCase();
      const types = C.types.filter(t => `${t.label} ${t.input} ${t.output} ${t.stop} ${t.criteria} ${C.families.find(f => f.id === t.family).label}`.toLowerCase().includes(q));
      $('catalog').innerHTML = (!q ? `<h3>핵심 엔티티</h3><div class="entity-add">${nodeKinds.map(k => `<button class="button small" type="button" data-add-kind="${k}">+ ${k}</button>`).join('')}</div>` : '') + C.families.map(f => {
        const ts = types.filter(t => t.family === f.id);
        return ts.length ? `<section class="catalog-family"><h3>${esc(f.label)} <small>${ts.length}종</small></h3>${ts.map(t => `<button class="catalog-tile" type="button" data-add-type="${t.id}"><strong>${esc(t.label)}</strong><small>${esc(t.input)} → ${esc(t.output)}</small></button>`).join('')}</section>` : '';
      }).join('') + (!types.length ? '<p class="empty">검색 결과가 없습니다.</p>' : '');
    }
    $('catalog-search').addEventListener('input', drawCatalog); drawCatalog();
  }
  function editPanel(n, opener, isNew = false) {
    const harness = n.kind === '하네스';
    const binding = (key, kind) => `<label class="stack">연결할 ${kind} <select name="${key}"><option value="">사용 안 함</option>${graph.nodes.filter(x => x.kind === kind).map(x => `<option value="${esc(x.id)}"${x.id === n[key] ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;
    const text = (key, label, size = 240, long = false) => `<label class="stack">${label}${long ? `<textarea name="${key}" rows="2" maxlength="${size}" required>${val(n, key)}</textarea>` : `<input name="${key}" value="${val(n, key)}" maxlength="${size}" required>`}</label>`;
    openDrawer(isNew ? 'NEW NODE' : 'NODE INSPECTOR', isNew ? '노드 설정 및 배치' : n.name, `<p class="muted">${esc(n.kind)}${harness ? ` · ${esc(M.catalog[n.type].label)}` : ''}${n.type === 'evaluation' ? ' · 외부 평가 레인에 배치됩니다.' : ''}</p><form id="node-form">${text('name', '카드 이름', 90)}${harness ? `${text('input', '입력 설명')}${text('output', '출력 설명')}<div class="form-grid">${text('inputSchema', '입력 스키마 ID', 48)}${text('outputSchema', '출력 스키마 ID', 48)}</div>${text('criteria', '판단 기준', 480, true)}${text('handoff', '핸드오프 경로', 480, true)}${text('stop', '중단 조건', 480, true)}${M.gate(n)?.kind === 'HITL' ? '<p class="muted">필수 안전 관문은 설명을 편집해도 해제되지 않습니다.</p>' : ''}` : `${text('value', n.kind === 'Workflow' ? '작업 지시' : '설정 / 정책', 500, true)}${n.kind === 'Workflow' ? binding('profileId', '프로필') + binding('loopId', '루프') : ''}${n.kind === '루프' ? `<label class="stack">최대 재시도 횟수 <input type="number" name="limit" min="0" max="10" value="${n.limit}" required></label><p class="muted">프로토타입은 정책 카드 편집을 지원하며 실제 재시도는 실행하지 않습니다.</p>` : ''}`}<div class="drawer-actions"><button type="submit" class="button primary">${isNew ? '캔버스에 배치' : '카드 변경 적용'}</button>${!isNew ? '<button type="button" class="button" id="delete-node">노드 삭제</button>' : ''}</div></form>`, opener);
    $('node-form').addEventListener('submit', e => {
      e.preventDefault();
      const data = Object.fromEntries(Array.from(new FormData(e.currentTarget), ([k, v]) => [k, v.trim()]));
      if (Object.entries(data).some(([k, v]) => !v && !['profileId', 'loopId'].includes(k))) return drawerError('공백만 입력할 수 없습니다.');
      if (harness && (!M.schemaId.test(data.inputSchema) || !M.schemaId.test(data.outputSchema))) return drawerError('스키마 ID는 영문 소문자로 시작하고 숫자·밑줄만 포함할 수 있습니다.');
      if ('limit' in data) data.limit = Number(data.limit);
      const next = { ...n, ...data };
      const updated = { ...graph, nodes: isNew ? [...graph.nodes, next] : graph.nodes.map(x => x.id === n.id ? next : x) };
      const error = M.validate(updated).error;
      if (error) return drawerError(`${error} 기존 연결이 있다면 먼저 연결 계약에서 해제하세요.`);
      graph = updated; closeDrawer(); changed(isNew ? '새 노드를 배치했습니다.' : '설계 초안에 카드 변경을 적용했습니다.'); focusNode(n.id);
    });
    $('delete-node')?.addEventListener('click', () => {
      if (active() && run.order.includes(n.id)) return drawerError('현재 실행이 끝나거나 반려된 뒤 이 노드를 삭제할 수 있습니다.');
      const hasEdge = graph.edges.some(e => [e.from, e.to].includes(n.id));
      if (hasEdge) return drawerError('이 노드의 연결 계약을 먼저 해제하세요.');
      graph.nodes = graph.nodes.filter(x => x.id !== n.id).map(x => x.kind === 'Workflow' ? { ...x, ...(x.profileId === n.id ? { profileId: '' } : {}), ...(x.loopId === n.id ? { loopId: '' } : {}) } : x);
      closeDrawer(); changed('설계 초안에서 노드를 삭제했습니다.'); $('add-btn').focus();
    });
  }
  function connectPanel(opener) {
    const list = M.harnesses(graph), opts = ns => ns.map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');
    openDrawer('EDGE CONTRACT', '노드 연결', `<p class="muted">출력, 전달 계약, 수신 입력의 스키마 ID가 같아야 합니다. 독립 평가는 받을 수만 있습니다.</p><form id="edge-form"><label class="stack">보내는 노드 <select name="from">${opts(list.filter(n => n.type !== 'evaluation'))}</select></label><label class="stack">받는 노드 <select name="to">${opts(list)}</select></label><label class="stack">핸드오프 스키마 ID <input name="schema" maxlength="48" required></label><p id="edge-preview" class="muted"></p><div class="drawer-actions"><button class="button primary" type="submit">연결 확인</button></div></form>`, opener);
    const form = $('edge-form'), { from, to, schema } = form.elements;
    to.value = list.find(n => n.id !== from.value)?.id || '';
    function preview() { $('edge-preview').textContent = `보내는 출력: ${M.field(def(from.value) || {}, 'outputSchema') || '없음'} / 받는 입력: ${def(to.value)?.inputSchema || '없음'}`; }
    function fromChanged() { schema.value = M.field(def(from.value) || {}, 'outputSchema'); preview(); }
    from.addEventListener('change', fromChanged); to.addEventListener('change', preview); fromChanged();
    form.addEventListener('submit', e => {
      e.preventDefault(); const edge = { from: from.value, to: to.value, schema: schema.value.trim() };
      const next = { ...graph, edges: [...graph.edges, edge] }, { error } = M.validate(next);
      if (error) return drawerError(error);
      graph = next; closeDrawer(); changed('연결 계약을 추가했습니다.'); $('contracts').open = true; $('connect-btn').focus();
    });
  }
  function closeDrawer() { if ($('drawer').open) $('drawer').close(); }
  function focusNode(id) { document.querySelector(`[data-edit="${CSS.escape(id)}"]`)?.focus(); }
  function startRun() {
    const ready = M.newRun(graph);
    if (ready.error) return notice(ready.error);
    run = ready; M.append(run, 'runtime', '작업 지시 접수', run.instruction); notice('현재 설계 스냅샷으로 모의 실행을 시작했습니다.'); nextStep();
  }
  function nextStep() {
    const current = run, id = current.order[current.index];
    if (!id) { current.phase = 'done'; M.append(current, 'runtime', '모의 실행 완료', '모든 실행 노드와 연결된 외부 평가를 마쳤습니다.'); render(); return; }
    const node = current.snapshot.nodes.find(n => n.id === id);
    current.phase = 'running'; current.statuses[id] = 'running';
    M.append(current, 'runtime', `${node.name} · 시작`, node.type === 'evaluation' ? '외부 평가 레인에서 산출물을 읽습니다. 실행 흐름을 수정할 수 없습니다.' : '실행 스냅샷의 입력 및 핸드오프 계약을 확인합니다.', id);
    render();
    setTimeout(() => {
      if (run !== current) return;
      const pending = M.gate(node);
      if (pending) {
        current.phase = 'waiting'; current.statuses[id] = 'waiting'; current.pending = { nodeId: id, ...pending };
        M.append(current, 'action', `${pending.kind} · ${pending.title}`, pending.prompt, id); render();
        notice(`${pending.kind} 개입 요청이 도착했습니다. 상단 버튼으로 해당 카드에 이동할 수 있습니다.`);
      } else { M.completeStep(current, node); nextStep(); }
    }, 600);
  }
  function intervene(action) {
    if (!run?.pending) return;
    const pending = run.pending, id = pending.nodeId, node = run.snapshot.nodes.find(n => n.id === id);
    const text = $('intervention-input')?.value.trim();
    const requiresText = ['answer', 'revise'].includes(action);
    if (requiresText && !text) { notice('답변 또는 수정 지시를 입력하세요.'); $('intervention-input')?.focus(); return; }
    const titles = { approve: '모의 승인', reject: '반려', answer: 'ASK 답변 전송', revise: '수정 지시 접수' };
    if (!titles[action] || action === 'answer' && pending.kind !== 'ASK') return;
    M.append(run, 'action', `${pending.kind} · ${action === 'answer' ? '답변 전송' : titles[action]}`, requiresText ? text : `${node.name}에서 ${titles[action]} 처리했습니다.`, id);
    if (action === 'reject') {
      run.pending = null; run.phase = 'stopped'; run.statuses[id] = 'stopped';
      M.append(run, 'runtime', '모의 실행 중단', '반려로 인해 이후 노드는 실행하지 않았습니다.'); render();
    } else if (action === 'revise' && pending.kind === 'HITL') {
      run.pending = { ...pending, prompt: '수정 지시를 기록했습니다. 관문은 여전히 대기 상태이며 실제 승인이나 실행은 발생하지 않았습니다.' }; render();
      if ($('intervention-input')) $('intervention-input').value = '';
    } else {
      M.completeStep(run, node, requiresText ? text : ''); nextStep();
    }
    notice(`${titles[action]}했습니다. 수행 내역에서 확인할 수 있습니다.`);
    if (run.pending) $('intervention')?.focus(); else focusNode(id);
  }
  const docName = s => s.replace(/\.(md|txt)$/i, '');
  const docTag = name => /결정|adr|architecture|아키텍처/i.test(name) ? '결정' : /진행|status|log/i.test(name) ? '진행' : '문서';
  function renderDocs(warning = '') {
    const mode = { sample: '예시 문서', live: '로컬 파일 연결 · 4초마다 확인', upload: '선택한 파일 · 다시 선택하면 갱신' }[docMode];
    $('docs-status').textContent = `${mode}${docsUpdated ? ` · ${docsUpdated}` : ''}${warning ? ` · ${warning}` : ''}`;
    $('docs-refresh').hidden = docMode !== 'live';
    $('docs-count').textContent = `${docs.length}건`;
    $('context-summary').innerHTML = M.summarize(docs).map(({ label, notes }) => `<section class="summary-item"><h3>${label}</h3>${notes.length ? notes.map(({ doc, heading, text }) => `<div><p>${esc(text)}</p><button type="button" class="text-button source" title="${esc(doc.name)} ${esc(heading)}" data-doc="${esc(doc.id)}">${esc(docName(doc.name))}${heading ? ` § ${esc(heading)}` : ''} ↗</button></div>`).join('') : '<p class="muted">연결한 문서에서 해당 항목을 찾지 못했습니다.</p>'}</section>`).join('');
    $('docs-list').innerHTML = docs.map(doc => `<button type="button" class="doc-row" data-doc="${esc(doc.id)}"><span aria-hidden="true">▤</span><strong>${esc(doc.name)}</strong>${chip(doc.tag)}<span aria-hidden="true">↗</span></button>`).join('');
  }
  async function readFiles(files) {
    const supported = files.filter(f => /\.(md|txt)$/i.test(f.name) && f.size <= 512 * 1024);
    const output = await Promise.all(supported.slice(0, 12).map(async (f, i) => ({ id: `doc-${i}`, name: f.name, tag: docTag(f.name), text: await f.text() })));
    return { output, warning: files.length > output.length ? '최대 12개·파일당 512KB의 MD/TXT만 표시합니다.' : '' };
  }
  async function setFiles(files, mode, revision) {
    const { output, warning } = await readFiles(files);
    if (revision !== docRevision) return;
    if (!output.length) return renderDocs(warning || '읽을 수 있는 텍스트 파일을 선택하세요.');
    const didChange = JSON.stringify(docs) !== JSON.stringify(output) || docMode !== mode;
    if (didChange) { docs = output; docMode = mode; docsUpdated = new Date().toLocaleTimeString('ko-KR'); renderDocs(warning); }
  }
  async function refreshDocs(revision = docRevision) {
    if (docRefreshBusy || !docHandles.length) return;
    docRefreshBusy = true;
    try { await setFiles(await Promise.all(docHandles.map(h => h.getFile())), 'live', revision); }
    catch { if (revision === docRevision) renderDocs('다시 읽지 못했습니다. 파일 이동·접근 권한을 확인하세요.'); }
    finally { docRefreshBusy = false; }
  }
  async function linkDocs() {
    if (!window.showOpenFilePicker) return $('docs-input').click();
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: '프로젝트 문서', accept: { 'text/plain': ['.txt', '.md'] } }] });
      docHandles = handles.slice(0, 12); const revision = ++docRevision;
      if (docRefreshBusy) await setFiles(await Promise.all(docHandles.map(h => h.getFile())), 'live', revision);
      else await refreshDocs(revision);
    } catch (err) { if (err.name !== 'AbortError') $('docs-input').click(); }
  }
  document.addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button) return;
    const d = button.dataset;
    if (d.edit) editPanel(def(d.edit), button);
    if (d.focus) focusNode(d.focus);
    if (d.selectTask) { graph.workflowId = d.selectTask; changed('다음 모의 실행에서 사용할 작업 지시를 바꿨습니다.'); focusNode(d.selectTask); }
    if (d.action) intervene(d.action);
    if (d.addKind) editPanel({ id: uid(), kind: d.addKind, name: '', value: '', limit: 1 }, button, true);
    if (d.addType) {
      const t = M.catalog[d.addType];
      editPanel({ id: uid(), kind: '하네스', type: t.id, name: t.label, inputSchema: ({ search: 'question', answer: 'evidence_list', evaluation: 'cited_answer' })[t.id] || 'task_input', handoff: t.handoff || '연결 계약에 따라 전달', stop: t.stop || '별도 조건 없음' }, button, true);
    }
    if (d.unlink) {
      const [from, to] = d.unlink.split('|'); graph.edges = graph.edges.filter(e => e.from !== from || e.to !== to);
      changed('연결 계약을 해제했습니다. 진행 중인 실행은 변경되지 않습니다.'); $('contracts').querySelector('summary').focus();
    }
    if (d.doc) {
      const doc = docs.find(x => x.id === d.doc);
      if (doc) openDrawer('PROJECT DOCUMENT / READ ONLY', doc.name, `<pre class="document-text">${esc(doc.text)}</pre>`, button);
    }
  });
  $('add-btn').onclick = e => addPanel(e.currentTarget);
  $('connect-btn').onclick = e => connectPanel(e.currentTarget);
  $('drawer-close').onclick = closeDrawer;
  $('drawer').addEventListener('close', () => { if (!document.activeElement?.closest('main') && lastOpener?.isConnected) lastOpener.focus(); });
  $('drawer').addEventListener('click', e => { if (e.target === $('drawer') && e.clientX < $('drawer').getBoundingClientRect().left) closeDrawer(); });
  $('save-btn').onclick = () => {
    try { if (M.validate(graph).error) throw new Error(); localStorage.setItem(storageKey, JSON.stringify(graph)); dirty = false; render(); notice('설계만 이 브라우저에 저장했습니다. 실행·개입·문서는 저장하지 않습니다.'); }
    catch { notice('설계를 저장하지 못했습니다. 브라우저 저장 권한을 확인하세요.'); }
  };
  $('run-btn').onclick = startRun;
  $('log-filter').onchange = renderJournal;
  $('jump-intervention').onclick = () => $('intervention')?.focus();
  $('docs-link').onclick = linkDocs;
  $('docs-refresh').onclick = () => refreshDocs();
  $('docs-input').onchange = async e => {
    const files = [...e.currentTarget.files]; e.currentTarget.value = ''; if (!files.length) return;
    docHandles = []; const revision = ++docRevision;
    try { await setFiles(files, 'upload', revision); } catch { if (revision === docRevision) renderDocs('읽을 수 없는 문서입니다.'); }
  };
  setInterval(() => { if (document.visibilityState === 'visible' && docMode === 'live') refreshDocs(); }, 4000);
  new ResizeObserver(requestDraw).observe($('graph'));
  render(); renderDocs();
})();
