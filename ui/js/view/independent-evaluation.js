/* 독립 평가: 완료된 실행을 읽기만 하고 별도 평가 기록을 남긴다. */
(() => {
  "use strict";

  const endpoint = "independent-evaluation";
  const sample = JSON.stringify([
    { path: "/summary/count", operator: "atLeast", value: 1 },
    { path: "/status", operator: "equals", value: "ok" },
  ], null, 2);
  const badge = { improved: "개선", regressed: "회귀", unchanged: "변화 없음" };
  let active;
  let projectHint;

  function el(tag, text = "", className = "") {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = "independent-evaluation-" + className;
    return node;
  }
  function field(label, control) {
    const wrapper = el("label", "", "field");
    wrapper.append(el("span", label), control);
    return wrapper;
  }
  function button(text, type = "button") {
    const node = el("button", text);
    node.type = type;
    return node;
  }
  function options(select, items, empty, value) {
    const entries = items.map(([id, label, title]) => {
      const option = el("option", label);
      option.value = id;
      if (title) option.title = title;
      return option;
    });
    if (empty) {
      const placeholder = el("option", empty);
      placeholder.value = "";
      entries.unshift(placeholder);
    }
    select.replaceChildren(...entries);
    if (value !== undefined && entries.some((entry) => entry.value === value)) select.value = value;
  }
  async function request(name, params, payload) {
    const reply = await window.engineeringApi.request(name, params, payload);
    if (!reply?.ok) throw new Error(reply?.error || "평가 요청에 실패했습니다.");
    return reply.value;
  }
  function status(view, text, error = false) {
    view.status.textContent = text;
    view.status.dataset.error = error ? "1" : "0";
  }
  function displayDigest(digest) {
    const node = el("code", digest.slice(0, 12), "digest");
    node.title = digest;
    node.setAttribute("aria-label", `SHA-256 ${digest}`);
    return node;
  }
  function paintResults(view, results) {
    view.results.replaceChildren();
    if (!results.length) {
      view.results.append(el("p", "이 실행의 독립 평가 기록이 없습니다.", "empty"));
      return;
    }
    for (const result of results) {
      const card = el("article", "", "result");
      const score = el("h4", `${result.score}점 · ${result.passed}/${result.total}개 통과`);
      const proof = el("p", `${result.node} / ${result.artifact} · 루브릭 `, "proof");
      proof.append(displayDigest(result.rubricDigest), document.createTextNode(" · 산출물 "), displayDigest(result.artifactDigest));
      const comparison = el("p", "같은 루브릭과 출력으로 평가한 이전 실행이 없습니다.", "regression");
      if (result.regression) {
        const { delta, baseline, status: change } = result.regression;
        comparison.dataset.status = change;
        comparison.textContent = `${badge[change]} · ${delta > 0 ? "+" : ""}${delta}점 (이전 ${baseline.score}점 · v${baseline.version} · ${baseline.runId.slice(0, 8)})`;
      }
      card.append(score, proof, comparison);
      if (result.manual) {
        const label = result.manual.decision === "pass" ? "통과" : "미통과";
        card.append(el("p", `수동 판정: ${label}${result.manual.note ? " · " + result.manual.note : ""}`, "manual"));
      } else {
        const form = el("form", "", "review");
        const decision = el("select");
        options(decision, [["pass", "통과"], ["fail", "미통과"]], "판정 선택");
        decision.required = true;
        const note = el("input");
        note.maxLength = 1000;
        const save = button("수동 판정 기록", "submit");
        form.append(field("수동 판정", decision), field("검토 메모 (선택)", note), save);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (!decision.value || view.selected?.id !== result.runId) return;
          void write(view, { operation: "review", id: result.runId, evaluationId: result.id,
            decision: decision.value, note: note.value.trim() }, "수동 판정을 기록했습니다.");
        });
        card.append(form);
      }
      view.results.append(card);
    }
  }
  function paint(view, data) {
    const selected = data?.selected ?? null;
    const old = view.selected?.id === selected?.id;
    const lastArtifact = old ? view.artifact.value : "";
    const lastPin = old ? view.pin.value : "";
    view.selected = selected;
    view.artifacts = selected?.artifacts ?? [];
    options(view.run, (data?.runs ?? []).map((run) => [run.id, `${run.title} · v${run.version} · ${run.id.slice(0, 8)}`]),
      "완료된 실행 선택", selected?.id);
    options(view.artifact, view.artifacts.map((ref, index) => [String(index), `${ref.node} / ${ref.name} (${ref.path})`]),
      view.artifacts.length ? "" : "검증 가능한 산출물 없음", lastArtifact);
    options(view.pin, (selected ? data.rubrics : []).map((rubric) => [rubric.digest,
      `${rubric.name} · ${rubric.cases}개 · ${rubric.digest.slice(0, 12)}`, rubric.digest]),
    selected && data.rubrics.length ? "" : "봉인된 루브릭 없음", view.newPin ?? lastPin);
    view.newPin = undefined;
    view.details.hidden = !selected;
    view.empty.hidden = Boolean(selected);
    view.empty.textContent = data?.runs?.length ? "평가할 성공 실행을 선택하세요." : "이 프로젝트에 평가 가능한 성공 실행이 없습니다.";
    paintResults(view, selected?.evaluations ?? []);
    controls(view);
  }
  function controls(view) {
    const busy = view.busy;
    view.project.disabled = busy || !view.project.options.length;
    view.refresh.disabled = busy || !view.project.value;
    view.run.disabled = busy || view.run.options.length < 2;
    view.evaluate.disabled = busy || !view.selected || !view.artifacts.length || !view.pin.value;
    view.seal.disabled = busy || !view.selected;
    for (const control of view.results.querySelectorAll("input, select, button")) control.disabled = busy;
  }
  async function load(view, id, message = "") {
    const state = ++view.state;
    const project = view.project.value;
    view.busy = true;
    controls(view);
    status(view, "평가 정보를 불러오는 중…");
    try {
      if (!project) { paint(view, null); return; }
      const params = id ? { project, id } : { project };
      const data = await request(endpoint, params);
      if (state !== view.state) return;
      paint(view, data);
      status(view, message);
    } catch (error) {
      if (state !== view.state) return;
      if (project !== view.loadedProject) paint(view, null);
      status(view, error.message, true);
    } finally {
      if (state === view.state) {
        view.loadedProject = project;
        view.busy = false;
        controls(view);
      }
    }
  }
  async function write(view, payload, message) {
    if (view.busy) return;
    const state = ++view.state;
    const project = view.project.value;
    const id = view.selected?.id;
    view.busy = true;
    controls(view);
    status(view, payload.operation === "evaluate" ? "산출물 무결성을 검증하고 채점하는 중…" : "평가 정보를 기록하는 중…");
    try {
      const result = await request(endpoint, undefined, { project, ...payload });
      if (state !== view.state) return;
      if (payload.operation === "seal") {
        view.name.value = "";
        view.cases.value = "";
        view.newPin = result.digest;
      }
      await load(view, id, message);
    } catch (error) {
      if (state !== view.state) return;
      view.busy = false;
      controls(view);
      status(view, error.message, true);
    }
  }
  async function projects(view) {
    view.busy = true;
    controls(view);
    status(view, "프로젝트를 불러오는 중…");
    try {
      const list = await request("projects");
      if (active !== view) return;
      const current = projectHint ?? view.project.value;
      options(view.project, list.filter((project) => !project.archived).map(({ id, name }) => [id, name]),
        "프로젝트 선택", current);
      if (view.project.value) await load(view);
      else status(view, "프로젝트를 선택하세요.");
    } catch (error) {
      status(view, error.message, true);
    } finally {
      view.busy = false;
      controls(view);
    }
  }
  function mount(host = document.getElementById("independent-evaluation")) {
    if (!host || active?.host === host) return;
    const view = active = { host, state: 0, artifacts: [] };
    view.project = el("select");
    view.run = el("select");
    view.refresh = button("새로고침");
    view.status = el("p", "", "status");
    view.status.setAttribute("role", "status");
    view.empty = el("p", "", "empty");
    view.details = el("div", "", "details");
    view.artifact = el("select");
    view.pin = el("select");
    view.evaluate = button("독립 평가 실행", "submit");
    view.seal = button("루브릭 봉인", "submit");
    view.results = el("div", "", "results");
    view.name = el("input");
    view.name.required = true;
    view.name.maxLength = 120;
    view.cases = el("textarea");
    view.cases.required = true;
    view.cases.rows = 6;
    view.cases.maxLength = 32768;
    view.cases.spellcheck = false;
    view.cases.placeholder = sample;
    const scope = el("div", "", "scope");
    scope.append(field("프로젝트", view.project), field("완료된 실행", view.run), view.refresh);
    const evaluateForm = el("form", "", "run");
    evaluateForm.append(field("기록된 JSON 산출물", view.artifact), field("봉인된 루브릭 · SHA-256", view.pin), view.evaluate);
    const author = el("details", "", "author");
    const sealForm = el("form", "", "seal");
    sealForm.append(field("루브릭 이름", view.name), field("평가 케이스 JSON 배열", view.cases),
      el("p", "1–50개, 32 KiB 이하. 각 항목은 path(JSON Pointer), operator, value로 구성합니다. 연산: exists(value 생략), equals, type, atLeast, atMost.", "help"),
      view.seal);
    author.append(el("summary", "새 루브릭 봉인"), sealForm);
    view.details.append(evaluateForm, author, el("h3", "평가 이력"), view.results);
    view.details.hidden = true;
    host.replaceChildren(el("h2", "독립 평가"), el("p", "완료된 실행의 산출물만 검증하고 채점합니다. 평가 기준은 대상 실행이나 프롬프트에 전달하지 않습니다.", "help"),
      scope, view.status, view.empty, view.details);
    view.project.addEventListener("change", () => {
      view.name.value = "";
      view.cases.value = "";
      void load(view);
    });
    view.run.addEventListener("change", () => {
      view.name.value = "";
      view.cases.value = "";
      void load(view, view.run.value);
    });
    view.refresh.addEventListener("click", () => void load(view, view.selected?.id));
    view.pin.addEventListener("change", () => controls(view));
    evaluateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const artifact = view.artifacts[view.artifact.value];
      if (!view.selected || !artifact || !view.pin.value) return;
      void write(view, { operation: "evaluate", id: view.selected.id, node: artifact.node, artifact: artifact.name,
        rubricDigest: view.pin.value }, "독립 평가 결과를 기록했습니다.");
    });
    sealForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!view.selected || view.busy) return;
      let cases;
      try { cases = JSON.parse(view.cases.value); } catch { status(view, "평가 케이스에 올바른 JSON 배열을 입력하세요.", true); return; }
      if (!Array.isArray(cases)) { status(view, "평가 케이스는 JSON 배열이어야 합니다.", true); return; }
      void write(view, { operation: "seal", workflow: view.selected.workflow, rubric: { name: view.name.value, cases } }, "루브릭을 봉인했습니다.");
    });
    void projects(view);
  }
  function show(project) {
    projectHint = project;
    mount();
    if (active && project && active.project.value !== project) {
      if (Array.from(active.project.options).some((option) => option.value === project)) {
        active.project.value = project;
        active.name.value = "";
        active.cases.value = "";
        void load(active);
      } else if (!active.busy) void projects(active);
    }
  }
  window.OMPIndependentEvaluation = { mount, show };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mount(), { once: true });
  else mount();
})();
