/* Unified-workspace prototype domain. No transport or external executor. */
(function () {
  'use strict';
  const { types } = globalThis.WORKSPACE_CATALOG;
  const catalog = Object.fromEntries(types.map(t => [t.id, t]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaultGraph = {
    version: 1, workflowId: 'workflow',
    nodes: [
      { id: 'workflow', kind: 'Workflow', name: '근거 기반 문의 응답', value: '관제 화면 통합 요구사항을 확인하고 근거와 함께 답변 초안을 작성한다.', profileId: 'profile', loopId: 'loop' },
      { id: 'profile', kind: '프로필', name: '문서 분석 에이전트', value: '읽기 전용 · 한국어 · 출처 필수' },
      { id: 'loop', kind: '루프', name: '근거 재확인 루프', value: '출처 불일치 시 검색부터 다시 확인', limit: 1 },
      { id: 'find', kind: '하네스', type: 'search', name: '검색 하네스', inputSchema: 'question' },
      { id: 'reply', kind: '하네스', type: 'answer', name: '답변 하네스', inputSchema: 'evidence_list' },
      { id: 'eval', kind: '하네스', type: 'evaluation', name: '평가 하네스', inputSchema: 'cited_answer' }
    ],
    edges: [{ from: 'find', to: 'reply', schema: 'evidence_list' }, { from: 'reply', to: 'eval', schema: 'cited_answer' }]
  };
  const harnesses = graph => graph.nodes.filter(n => n.kind === '하네스');
  const selectedTask = graph => graph.nodes.find(n => n.kind === 'Workflow' && n.id === graph.workflowId) || graph.nodes.find(n => n.kind === 'Workflow');
  const field = (node, key) => node[key] ?? catalog[node.type]?.[key] ?? '';
  const schemaId = /^[a-z][a-z0-9_]{0,47}$/;
  function validate(graph) {
    const nodeIds = new Set();
    for (const node of graph.nodes) {
      if (!node || typeof node.id !== 'string' || !/^[a-z0-9-]+$/i.test(node.id) || nodeIds.has(node.id) || typeof node.name !== 'string' || !['하네스', '프로필', '루프', 'Workflow'].includes(node.kind)) return { error: '노드 식별자 또는 유형이 잘못되었습니다.' };
      if (node.kind === '하네스' && !Object.hasOwn(catalog, node.type)) return { error: '등록되지 않은 하네스 유형입니다.' };
      nodeIds.add(node.id);
    }
    const list = harnesses(graph);
    const known = new Map(list.map(n => [n.id, n]));
    const counts = new Map(list.map(n => [n.id, 0]));
    const outgoing = new Map(list.map(n => [n.id, []]));
    const pairs = new Set();
    for (const node of list) {
      if (!schemaId.test(node.inputSchema) || !schemaId.test(field(node, 'outputSchema'))) return { error: `${node.name}: 입출력 스키마 ID를 확인하세요.` };
    }
    for (const edge of graph.edges) {
      const a = known.get(edge.from), b = known.get(edge.to);
      if (!a || !b || a === b) return { error: '서로 다른 하네스 두 개를 선택하세요.' };
      if (a.type === 'evaluation') return { error: '외부 평가의 결과는 실행 흐름으로 다시 연결할 수 없습니다.' };
      if (pairs.has(`${a.id}>${b.id}`)) return { error: '이미 연결된 노드입니다.' };
      if (!schemaId.test(edge.schema) || edge.schema !== field(a, 'outputSchema') || edge.schema !== b.inputSchema) return { error: `스키마 불일치: ${a.name}(${field(a, 'outputSchema')}) → ${b.name}(${b.inputSchema}).` };
      pairs.add(`${a.id}>${b.id}`);
      outgoing.get(a.id).push(b.id);
      counts.set(b.id, counts.get(b.id) + 1);
    }
    const ready = list.map(n => n.id).filter(id => counts.get(id) === 0), sorted = [];
    while (ready.length) {
      const id = ready.shift();
      sorted.push(known.get(id));
      for (const next of outgoing.get(id)) {
        counts.set(next, counts.get(next) - 1);
        if (!counts.get(next)) ready.push(next);
      }
    }
    if (sorted.length !== list.length) return { error: '실행 연결에는 순환을 만들 수 없습니다. 재시도 정책은 루프 카드에서 정의하세요.' };
    return { order: sorted.filter(n => n.type !== 'evaluation').concat(sorted.filter(n => n.type === 'evaluation' && graph.edges.some(e => e.to === n.id))) };
  }
  const statusText = { ready: '준비', running: '실행 중', waiting: '개입 대기', done: '완료', stopped: '중단', revised: '수정 반영', idle: '미실행' };
  const phases = { all: '전체', artifact: '산출물', action: '개입', runtime: '실행' };
  const mandatory = {
    browser: ['결제·동의·비밀번호', '민감한 브라우저 동작 직전입니다. 모의 수행을 승인하거나 반려하세요. 비밀번호나 결제 정보는 입력하지 마세요.'],
    system: ['UAC 승인', '관리자 권한이 필요한 단계입니다. 실제 UAC 권한은 앱 밖에서 별도로 승인해야 합니다.'],
    deploy: ['외부 반영 승인', '원격 푸시와 외부 공개는 모의 동작입니다. 계속하기 전에 범위를 확인하세요.']
  };
  function gate(node) {
    if (mandatory[node.type]) return { kind: 'HITL', title: mandatory[node.type][0], prompt: mandatory[node.type][1] };
    if (node.type === 'answer') return { kind: 'ASK', title: '답변 범위 확인', prompt: '현재 확보한 근거만으로 답변할까요? 승인하거나, 필요한 범위와 톤을 인라인으로 알려주세요.' };
    if (node.type === 'classify') return { kind: 'ASK', title: '필수 값 확인', prompt: '필수 값이 비어 있는 상황입니다. 확인한 값만 기재하거나 작업을 반려하세요.' };
    return null;
  }
  function newRun(graph) {
    const plan = validate(graph);
    if (plan.error) return plan;
    if (!plan.order.some(n => n.type !== 'evaluation')) return { error: '실행할 하네스를 먼저 추가하세요.' };
    const snapshot = clone(graph), task = selectedTask(snapshot);
    return { id: `SIM-${Date.now().toString(36).slice(-5).toUpperCase()}`, snapshot, task: task?.name || '커스텀 작업', instruction: task?.value || '편집한 그래프를 모의 실행한다.', order: plan.order.map(n => n.id), statuses: {}, results: {}, entries: [], index: 0, pending: null, phase: 'ready' };
  }
  function append(run, kind, title, body, nodeId = '') {
    run.entries.push({ kind, title, body, nodeId, time: new Date().toLocaleTimeString('ko-KR', { hour12: false }) });
  }
  function demoArtifact(node, run, text) {
    const inputs = run.snapshot.edges.filter(e => e.to === node.id && run.results[e.from]);
    const received = inputs.length ? inputs.map(e => e.schema).join(', ') : '작업 지시 및 지정 입력';
    let detail = {
      search: '근거 후보 2건: 프로젝트 기획 요약 §목적, 통합 관제 설계 메모 §주요 결정. 아직 답변을 생성하지 않았습니다.',
      answer: '답변 초안: 설계와 관제를 같은 캔버스에 두고, 실행 기록·사람 개입·프로젝트 문서를 함께 표시합니다. [1] 기획 요약 §목적, [2] 설계 메모 §주요 결정',
      evaluation: '독립 관찰: 전달 스키마를 확인했습니다. 실제 봉인 문항·휴먼 채점은 실행하지 않았으므로 품질 점수는 산정하지 않습니다.',
      code: '모의 Diff: 관제 상태 배지를 캔버스 노드에 붙이는 1개 변경 후보. 실제 파일·빌드에는 손대지 않았습니다.'
    }[node.type] || `“${field(node, 'output')}” 예시를 생성했습니다. 실제 도구 호출은 하지 않았습니다.`;
    if (text) detail += `\n사용자 입력 반영: ${text}`;
    return { schema: field(node, 'outputSchema'), detail, received };
  }
  function completeStep(run, node, text) {
    const result = demoArtifact(node, run, text);
    run.results[node.id] = result;
    run.statuses[node.id] = 'done';
    append(run, 'artifact', `${node.name} · 산출물`, `${result.detail}\n입력: ${result.received}  /  출력 스키마: ${result.schema}`, node.id);
    run.index++;
    run.pending = null;
  }
  function initialRun() {
    const run = newRun(defaultGraph);
    run.id = 'SIM-014';
    append(run, 'runtime', '작업 지시 접수', run.instruction);
    completeStep(run, defaultGraph.nodes.find(n => n.id === 'find'));
    run.phase = 'waiting';
    run.statuses.reply = 'waiting';
    run.pending = { nodeId: 'reply', ...gate(defaultGraph.nodes.find(n => n.id === 'reply')) };
    append(run, 'action', 'ASK · 답변 범위 확인', '검색 결과 계약 evidence_list를 인계했습니다. 답변 범위를 확인하기 위해 대기 중입니다.', 'reply');
    return run;
  }
  const exampleDocs = [
    { id: 'purpose', name: '프로젝트 기획 요약.md', tag: '기획', text: '# 프로젝트 기획 요약\n## 목적\n분리된 관제와 노드 캔버스를 하나의 워크스페이스로 통합한다. 설계, 실행 관찰, 사람 개입에 같은 카드를 사용한다.' },
    { id: 'progress', name: '프로토타입 진행 로그.md', tag: '진행', text: '# 프로토타입 진행 로그\n## 진행 현황\n6대 계열·18종 카탈로그와 통합 화면을 검증한다. 현재 예시는 검색을 완료했고, 답변 범위 확인을 기다린다.' },
    { id: 'decisions', name: '통합 관제 설계 메모.md', tag: '결정', text: '# 통합 관제 설계 메모\n## 주요 결정\n연결선에 핸드오프 스키마를 표시한다. 평가는 검증 대상 워크플로우 밖에서 산출물만 읽는다. 결제·비밀번호·UAC는 사람에게 넘긴다.' }
  ];
  const contextKeys = [
    ['목적', /(?:목적|목표|purpose|objective|overview)/i],
    ['진행 현황', /(?:현황|진행|상태|status|progress|current)/i],
    ['주요 결정', /(?:결정|합의|decision|adr|architecture|아키텍처)/i]
  ];
  function summarize(docs) {
    return contextKeys.map(([label, match]) => {
      const found = [];
      for (const doc of docs) {
        let heading = '', active = false;
        for (const line of doc.text.split(/\r?\n/)) {
          const h = line.match(/^#{1,6}\s+(.+)$/);
          if (h) { heading = h[1]; active = match.test(heading); continue; }
          const text = line.trim().replace(/^[-*]\s+/, '');
          if (text && (active || match.test(text))) {
            found.push({ doc, heading, text: text.length > 170 ? text.slice(0, 167) + '…' : text });
            break;
          }
        }
      }
      return { label, notes: found.slice(0, 2) };
    });
  }
  globalThis.WORKSPACE_MODEL = { catalog, clone, defaultGraph, field, schemaId, harnesses, selectedTask, validate, newRun, append, gate, completeStep, initialRun, statusText, phases, exampleDocs, summarize };
})();
