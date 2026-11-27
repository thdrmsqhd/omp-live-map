// 칸반 위 요약 한 줄: '최근 7일 실행 12건 · $3.40 / 예산 $100.00'. 기간·예산 금액을 누르면 그 자리에서 고친다
// (Enter·포커스 이동 = 저장, Esc = 취소, 예산을 비우면 제한 없음). 예산이 있으면 그 예산 기간이 집계 기간이다.
import { dollars } from "./sdlc-card.js";

const PERIOD_KEY = "omp-tasks-period";

export function bindSummary({ find, request, need }) {
  const line = find("sdlc-summary");
  let project = "", budget = null, metrics = null, generation = 0;
  const days = () => budget?.days ?? readJSON(PERIOD_KEY, 7);
  const editing = () => line.contains(document.activeElement);

  function button(text, label, onEdit) {
    const element = Object.assign(document.createElement("button"), { type: "button", className: "inline-num", textContent: text });
    element.setAttribute("aria-label", label + " 고치기");
    element.title = label + " · 눌러서 고치기";
    element.onclick = () => onEdit(element);
    return element;
  }
  function paint() {
    if (editing()) return;
    const count = metrics?.measures?.count ?? 0;
    const spent = budget ? Math.ceil(budget.committed) : (metrics?.usage ?? []).reduce((sum, item) => sum + (item.costCents ?? 0), 0);
    const period = button(`최근 ${days()}일`, "집계 기간", (target) => inlineEdit(target, {
      value: String(days()), type: "number", min: 1, max: 90, label: "집계 기간(일)",
      onSave: async (value) => {
        const next = Math.round(Number(value));
        if (!(next >= 1 && next <= 90)) throw new Error("기간은 1~90일입니다.");
        writeJSON(PERIOD_KEY, next);
        if (budget) budget = (await request("project-budget", {}, { project, cap: budget.cap, days: next })).current;
        await load(project);
      } }));
    const cap = button(budget ? dollars(budget.cap) : "없음", "프로젝트 예산", (target) => inlineEdit(target, {
      value: budget ? (budget.cap / 100).toFixed(2) : "", type: "number", min: 0, max: 10000, step: 0.01,
      label: "프로젝트 예산(달러)", placeholder: "비우면 제한 없음",
      onSave: async (value) => {
        const owner = await need();
        budget = value === "" ? (await request("project-budget", {}, { project: owner, remove: true })).current
          : (await request("project-budget", {}, { project: owner, cap: Math.round(Number(value) * 100), days: days() })).current;
        paint();
      } }));
    line.replaceChildren(period, ` 실행 ${count}건 · ${dollars(spent)} / 예산 `, cap);
    line.title = budget ? "omp·claude가 보고한 사용 금액과 실행 중 예약을 더한 값입니다. 예산을 넘으면 다음 실행을 시작하지 않습니다." : "";
  }
  async function load(id) {
    const revision = ++generation;
    project = id;
    if (!id) { budget = null; metrics = null; paint(); return; }
    const current = (await request("project-budget", { project: id })).current;
    if (revision !== generation) return;
    budget = current;
    const dashboard = await request("workflow-dashboard", { project: id, days: days() });
    if (revision !== generation) return;
    metrics = dashboard;
    paint();
  }
  return { load, refresh: () => (project && !editing() ? load(project) : Promise.resolve()) };
}
