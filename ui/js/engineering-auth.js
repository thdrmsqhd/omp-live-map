// 예산 입력 이름(설계 캔버스의 루프·비교 실행). 관제 화면(index.html)의 맵·설계·Task 탭이 함께 쓰는 일반 스크립트다.
// 실행은 이 PC 의 omp·claude CLI 로 하며, 사용 금액은 각 CLI 가 단계가 끝난 뒤 보고한 값이다.
const ENGINEERING_BUDGET_WORDS = {
  run: "실행 예산(센트)", trial: "실행별 예산(센트)", loop: "예산(센트)", project: "프로젝트 예산(센트)",
  hint: "omp·claude가 단계마다 보고한 사용 금액을 더해, 이 상한을 넘으면 다음 단계로 넘어가지 않고 멈춥니다.",
};
function engineeringBudgetLabel(kind) { return ENGINEERING_BUDGET_WORDS[kind]; }
// omp·claude CLI 를 찾지 못했으면 시작 전에 보여 줄 문구(서버 "runtime" 응답의 detail)를 돌려준다.
function engineeringRuntimeWarning(runtime) {
  return runtime?.status === "unavailable" ? runtime.detail : "";
}
