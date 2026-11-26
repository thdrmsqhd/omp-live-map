"use strict";

// 6계열 18종. 화면과 서버가 이 파일 하나를 그대로 읽는다.
// 역할 접두어(예: "평가 하네스 · 품질") 판정은 이 모듈 안에만 둔다.
const HARNESS_KINDS = {
  families: [
    { id: 'information', label: '정보를 다루는 하네스' },
    { id: 'creation', label: '만들어 내는 하네스' },
    { id: 'action', label: '행동하는 하네스' },
    { id: 'time', label: '시간을 다루는 하네스' },
    { id: 'judgment', label: '판단하는 하네스' },
    { id: 'conversation', label: '사람과 대화하는 하네스' },
  ],
  types: [
    {
      id: 'search', family: 'information', label: '검색',
      input: '질문, 허용된 출처 범위, 비교할 상위 후보 수',
      output: '순위·출처 위치·인용 후보를 담은 근거 목록',
      criteria: '정답 근거가 상위 K개 안에 포함됐는지 목록 자체를 평가한다.',
      handoff: '근거 목록만 답변 하네스에 넘긴다. 검색 하네스는 답을 작성하지 않는다.',
      stop: '검색 범위를 다 확인해도 근거가 없으면 근거 없음으로 멈춘다.',
      outputSchema: 'evidence_list',
    },
    {
      id: 'answer', family: 'information', label: '답변',
      input: '질문과 검색 하네스가 넘긴 근거 목록',
      output: '주장마다 확인된 출처를 붙인 답변 또는 답변 불가 사유',
      criteria: '주장이 출처와 일치하며, 지어낸 내용이 없고, 근거가 없을 때 답변을 거절한다.',
      handoff: '출처를 확인한 답변은 사용자에게 전한다. 출처가 틀리면 검색 하네스로 되돌린다.',
      stop: '검증 가능한 근거가 없거나 서로 충돌하는 근거를 해소하지 못하면 단정하지 않는다.',
      outputSchema: 'cited_answer',
    },
    {
      id: 'extract', family: 'information', label: '요약·추출',
      input: '긴 문서나 영상 프레임, 추출할 항목과 출력 형식',
      output: '원문 위치를 표시한 요약·표·필드와 판독 불가 항목',
      criteria: '원문에 있는 내용만 담고, 필요한 필드를 빠뜨리지 않는다.',
      handoff: '출처 위치를 붙인 추출 결과를 정형화 또는 문서 하네스에 넘긴다.',
      stop: '원문이 없거나 번호·날짜 등을 판독할 수 없으면 추측하지 않고 미확인으로 남긴다.',
      outputSchema: 'extracted_content',
    },
    {
      id: 'classify', family: 'information', label: '분류·정형화',
      input: '자유 형식 문장, 양식 키, 허용 분류와 필수 필드',
      output: '등록 전 정형 레코드와 확인이 필요한 필드 목록',
      criteria: '정해진 키를 모두 채우고, 근거 없는 값은 지어내지 않고 확인 필요로 표시한다.',
      handoff: '검증한 레코드는 이슈 접수나 보관함 등록 단계에 넘긴다. 미확인 필드는 사용자에게 돌려준다.',
      stop: '필수값을 확인할 수 없거나 분류가 모호하면 등록하지 않고 확인을 기다린다.',
      outputSchema: 'structured_record',
    },
    {
      id: 'visualization', family: 'creation', label: '시각화',
      input: '원본 데이터, 단위와 집계 기준, 보여 줄 관계',
      output: '렌더링한 차트·그림과 데이터 출처',
      criteria: '실행 오류가 없고, 렌더링 결과의 글자가 깨지지 않으며, 축·단위·범례가 데이터와 맞는다.',
      handoff: '검증한 그림과 캡션을 문서 하네스에 넘긴다. 문서에 삽입하는 일은 문서 하네스가 맡는다.',
      stop: '데이터나 단위가 불명확하거나 렌더링에 실패하면 그림을 확정하지 않는다.',
      outputSchema: 'visual_asset',
    },
    {
      id: 'document', family: 'creation', label: '문서',
      input: '내용, 인용할 근거, 삽입할 그림, 문서 양식과 말투',
      output: '지정한 형식의 문서 파일(마크다운·PDF·워드)과 출처 목록',
      criteria: '말투·양식이 요구와 일치하고, 페이지 구분·그림 배치가 올바르며, 인용 출처가 구분된다.',
      handoff: '검수본을 사용자에게 넘긴다. 게시가 필요하면 승인된 최종본만 배포 단계에 넘긴다.',
      stop: '필수 자료가 없거나 페이지·인용 검수에 실패하면 최종본으로 확정하지 않는다.',
      outputSchema: 'document_artifact',
    },
    {
      id: 'code', family: 'creation', label: '코드',
      input: '요구사항, 수정 가능 범위, 빌드·테스트 조건',
      output: '변경된 코드, 변경 범위와 빌드·테스트 결과',
      criteria: '빌드와 테스트가 통과하며 변경이 요청 범위를 벗어나지 않는다.',
      handoff: '변경 내용과 검증 결과를 독립 검증 하네스에 넘긴다. 검증을 통과한 변경만 배포·커밋에 넘긴다.',
      stop: '범위를 벗어난 수정이 필요하거나 검증이 실패하면 배포로 넘기지 않는다.',
      outputSchema: 'code_change',
    },
    {
      id: 'design', family: 'creation', label: 'UI·디자인',
      input: '화면 요구, 대상 화면 크기, 사용 흐름과 현재 화면',
      output: '개선 화면 또는 프로토타입과 변경 전후 스크린샷',
      criteria: '스크린샷을 육안으로 비교해 요구한 배치 변화가 실제 화면에 보이는지, 잘림은 없는지 확인한다.',
      handoff: '확인한 화면과 검수 결과를 사용자 또는 코드 하네스에 넘긴다.',
      stop: '화면의 배치 변화를 확인할 수 없거나 요구한 화면 상태를 재현하지 못하면 승인 요청 전 멈춘다.',
      outputSchema: 'design_artifact',
    },
    {
      id: 'browser', family: 'action', label: '브라우저·데스크톱 조작',
      input: '달성할 화면 상태, 대상 탭·앱과 허용된 조작 범위',
      output: '수행한 조작과 확인한 최종 화면 상태',
      criteria: '조작 뒤 화면이 목표 상태인지 다시 확인하고 사용자 포커스를 빼앗지 않는다.',
      handoff: '조작 결과 또는 결제·동의·비밀번호 입력 직전의 화면을 사용자에게 넘긴다.',
      stop: '결제, 동의, 비밀번호 입력 앞에서 멈춘다. 사용자가 직접 처리하기 전에는 진행하지 않는다.',
      outputSchema: 'interaction_result',
    },
    {
      id: 'system', family: 'action', label: '시스템 운영',
      input: '설치·설정 요청, 대상 시스템, 허용된 변경과 권한 범위',
      output: '변경 사항과 실제로 측정한 서비스·포트·방화벽 상태',
      criteria: '명령 성공 여부만 보지 않고 서비스 동작, 포트, 방화벽 상태를 변경 뒤 실제로 측정한다.',
      handoff: '변경 후 측정값을 사용자에게 보고한다. UAC 승인은 사용자에게 넘긴다.',
      stop: 'UAC 화면에서는 멈춘다. 사용자가 직접 승인하기 전에는 진행하거나 우회하지 않는다.',
      outputSchema: 'system_change_report',
    },
    {
      id: 'deploy', family: 'action', label: '배포·커밋',
      input: '검증을 통과한 변경, 작성자 메일, 대상 브랜치·원격과 공개 범위',
      output: '커밋 식별자와 푸시·공개의 원격 반영 확인 기록',
      criteria: '작성자 메일이 맞고 비공개 파일이나 비밀값이 포함되지 않으며 결과가 원격에 실제 반영됐는지 확인한다.',
      handoff: '반영 위치와 버전을 사용자에게 보고한다. 검증 실패는 코드 하네스에 되돌린다.',
      stop: '검증 미통과, 작성자·대상 불일치, 비공개 파일 포함, 푸시·공개 승인 누락 시 멈춘다.',
      outputSchema: 'deployment_record',
    },
    {
      id: 'reminder', family: 'time', label: '예약·알림',
      input: '할 일, 발송 일시·시간대, 수신 위치와 반복 조건',
      output: '예약 시각과 실제 발송 시각·성공 여부를 담은 알림 기록',
      criteria: '사용자의 시간대 기준으로 정해진 시각에 발송했는지 실제 시각과 대조한다.',
      handoff: '지정한 수신 위치에 메시지를 보낸다. 늦거나 실패하면 사용자에게 상태를 알린다.',
      stop: '시간대·수신 위치가 확정되지 않으면 예약하지 않는다. 지난 알림은 정상 발송으로 표시하지 않는다.',
      outputSchema: 'reminder_delivery',
    },
    {
      id: 'watch', family: 'time', label: '감시',
      input: '허용된 출처, 비교할 마지막 상태, 확인 주기와 변경 조건',
      output: '이전 상태와 달라진 항목만 담은 알림과 점검 기록',
      criteria: '새 항목이나 바뀐 항목을 놓치지 않으며 같은 변경을 중복 알리지 않는다.',
      handoff: '변경 근거와 관측 시각을 사용자 또는 요약·추출 하네스에 넘긴다.',
      stop: '출처를 읽지 못하면 변경 없음으로 처리하지 않고 마지막 정상 기준점을 그대로 둔다.',
      outputSchema: 'change_digest',
    },
    {
      id: 'evaluation', family: 'judgment', label: '평가',
      input: '평가 대상 시스템과 버전, 봉인된 시험셋, 채점 기준과 기준선',
      output: '독립 평가자의 점수·회귀 결과와 사람 채점 대조 기록',
      criteria: '봉인된 시험셋을 유지하고, 사람 채점과 자동 채점의 일치도를 확인하며, 기준선 대비 회귀를 표시한다.',
      handoff: '항상 대상 하네스 바깥의 독립 평가자가 판정한다. 튜닝에는 시험 문항·정답이 아니라 평가 요약만 넘긴다.',
      stop: '시험셋이 누출되거나 평가와 튜닝의 경계가 섞이면 판정을 중단하고 시험셋과 독립성을 확인한다.',
      outputSchema: 'evaluation_report',
    },
    {
      id: 'recommend', family: 'judgment', label: '비교·추천',
      input: '선택지, 사용 목적, 비교 기준, 예산과 명시적 제외 조건',
      output: '조건을 통과한 후보의 순위와 근거, 제외 사유',
      criteria: '사용자가 정한 제외 조건을 지키고 가격·라이선스를 최신 확인 근거와 함께 비교한다.',
      handoff: '순위와 후보별 장단점을 사용자에게 넘긴다. 구매나 계약은 대신 확정하지 않는다.',
      stop: '조건을 통과한 후보가 없거나 핵심 가격·라이선스를 확인하지 못하면 확정 추천을 멈춘다.',
      outputSchema: 'ranked_recommendation',
    },
    {
      id: 'diagnose', family: 'judgment', label: '진단',
      input: '증상, 발생 조건, 변경 이력과 확인 가능한 로그·측정값',
      output: '원인 후보, 관측 근거, 우선순위를 붙인 확인 순서',
      criteria: '관측한 사실과 추정을 구분하고, 각 확인 단계가 어떤 후보를 가려내는지 설명한다.',
      handoff: '확인 계획은 사용자에게, 확인된 원인과 근거는 담당 코드 또는 운영 하네스에 넘긴다.',
      stop: '원인을 입증할 측정이 없으면 단정하지 않는다. 상태 변경은 승인받기 전 진행하지 않는다.',
      outputSchema: 'diagnostic_report',
    },
    {
      id: 'coaching', family: 'conversation', label: '인터뷰·코칭',
      input: '사용자 목표, 대화 맥락, 이미 합의한 결정과 피드백 기준',
      output: '현재 질문 하나와 답변에 대한 구체적인 피드백',
      criteria: '한 번에 질문 하나만 하고 이미 정해진 결정을 다시 묻지 않는다.',
      handoff: '사용자 답변을 기다린 뒤 피드백과 다음 질문 또는 종합 의견을 사용자에게 전한다.',
      stop: '답변 대기 중에는 새 질문을 던지지 않는다. 합의한 목표에 도달하거나 사용자가 요청하면 종료한다.',
      outputSchema: 'coaching_exchange',
    },
    {
      id: 'learning', family: 'conversation', label: '학습',
      input: '시험 범위, 현재 수준, 목표 점수와 완료 정답률',
      output: '우선 학습 개념, 연습 문제, 채점 결과와 보완 항목',
      criteria: '70점 등 목표 점수에 맞춰 범위를 좁히고 실제 정답률로 합의한 완료 기준을 확인한다.',
      handoff: '풀이와 채점 피드백을 학습자에게 전한다. 목표 미달이면 오답 항목을 다음 학습에 넘긴다.',
      stop: '완료 정답률을 충족하면 마친다. 채점 근거가 없거나 정답률이 미달이면 완료로 처리하지 않는다.',
      outputSchema: 'learning_assessment',
    },
  ].map(type => ({ ...type, label: `${type.label} 하네스` })),
};

const root = typeof globalThis === "object" ? globalThis : Function("return this")();

root.harnessTypeOf = function harnessTypeOf(role) {
  if (typeof role !== "string") return null;
  return HARNESS_KINDS.types.find(({ label }) => role === label || role.startsWith(label + " · ")) || null;
};

root.isEvaluationRole = function isEvaluationRole(role) {
  return root.harnessTypeOf(role)?.id === "evaluation";
};

// 브라우저·시스템 역할만 수동 중단이다. 종류 id로 판정한다.
root.gateForRole = function gateForRole(role) {
  const id = root.harnessTypeOf(role)?.id;
  if (id === "browser") return "browser";
  if (id === "system") return "uac";
  return null;
};

root.WORKSPACE_CATALOG = HARNESS_KINDS;

if (typeof module === "object" && module && module.exports) {
  module.exports = {
    HARNESS_KINDS,
    harnessTypeOf: root.harnessTypeOf,
    isEvaluationRole: root.isEvaluationRole,
    gateForRole: root.gateForRole,
  };
}
