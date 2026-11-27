// 노드 캔버스 모듈들이 함께 쓰는 배치 상수와 저장된 배치 읽기.
export const COLUMN = { model: 0, harness: 400, loop: 800 };
export const KIND_ORDER = { model: 0, harness: 1, loop: 2 };
export const WORKFLOW_X = 1220, SX = 2, SY = 2.6, GAP = 28;
// 자동 맞춤의 최소 배율. 글자를 읽을 수 있어야 한다. '전체 보기' 버튼만 이보다 작게 줄인다.
export const READABLE = { workflow: .7, library: .6 };
// v2: 기본 접힘을 도입하면서 한 열로 쌓인 이전 위치를 한 번 버린다.
export const LAYOUT_KEY = "omp-studio-layout-v2";
export const TYPE_LABELS = { model: "모델", harness: "하네스", loop: "루프", flow: "실행 순서" };
export const PORT_NAMES = { next: "다음", true: "참", false: "거짓", approved: "승인", rejected: "거절" };
export const clamp = (value) => Math.min(10000, Math.max(0, Math.round(value)));
export const blankDocument = () => ({ name: "", nodes: [
  { id: "start", type: "start", label: "Start", x: 0, y: 40 },
  { id: "end", type: "end", label: "End", x: 420, y: 40 },
], edges: [] });

export function readLayout() {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
