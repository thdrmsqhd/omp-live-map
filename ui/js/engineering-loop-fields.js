export function bindLoopFields(find, options) {
  const fields = find("definition-loop-fields");
  const control = (name) => fields.querySelector(`[name="${name}"]`);
  const checks = find("definition-loop-checks");
  const add = find("definition-loop-add-check");

  function removal(label, remove) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = remove;
    return button;
  }

  function field(parent, label, input) {
    const wrap = document.createElement("label");
    wrap.append(label, input);
    parent.append(wrap);
  }

  function syncChecks() {
    add.disabled = checks.children.length >= 10;
    for (const row of checks.children) row.lastElementChild.disabled = checks.children.length < 2;
  }

  function addCheck({ command = "", args = [], code = 0 } = {}) {
    const row = document.createElement("fieldset");
    const heading = document.createElement("legend");
    heading.textContent = "검증 명령";
    row.append(heading);
    const executable = document.createElement("input");
    Object.assign(executable, { value: command, required: true, maxLength: 240, className: "loop-command" });
    field(row, "실행 파일", executable);
    const expected = document.createElement("input");
    Object.assign(expected, { type: "number", min: 0, max: 255, value: code, required: true, className: "loop-code" });
    field(row, "예상 종료 코드", expected);
    const argumentsList = document.createElement("div");
    argumentsList.className = "loop-arguments";
    row.append(argumentsList);
    const argumentButton = removal("인수 추가", () => appendArgument(""));

    function appendArgument(value) {
      const line = document.createElement("div");
      const input = document.createElement("textarea");
      Object.assign(input, { rows: 1, maxLength: 1000, value });
      field(line, "인수", input);
      line.append(removal("인수 삭제", () => {
        line.remove();
        argumentButton.disabled = false;
      }));
      argumentsList.append(line);
      argumentButton.disabled = argumentsList.children.length >= 24;
    }

    args.forEach(appendArgument);
    row.append(argumentButton, removal("명령 삭제", () => { row.remove(); syncChecks(); }));
    checks.append(row);
    syncChecks();
  }
  add.onclick = () => addCheck();

  return {
    show(payload, harnesses, active) {
      fields.disabled = fields.hidden = !active;
      if (!active) return;
      control("loopName").value = payload.name;
      control("attempts").value = payload.attempts;
      control("seconds").value = payload.timeoutMs / 1000;
      control("budgetCents").value = payload.budgetCents;
      options(control("loopHarness"), harnesses, "하네스 선택", payload.harness);
      find("definition-loop-hint").hidden = Boolean(harnesses.length);
      find("definition-loop-harness").hidden = Boolean(harnesses.length);
      checks.replaceChildren();
      payload.checks.forEach(addCheck);
    },
    payload() {
      return { name: control("loopName").value, harness: control("loopHarness").value,
        attempts: control("attempts").valueAsNumber, timeoutMs: Math.round(control("seconds").valueAsNumber * 1000),
        budgetCents: control("budgetCents").valueAsNumber,
        checks: [...checks.children].map((row) => ({ command: row.querySelector(".loop-command").value,
          args: [...row.querySelectorAll(".loop-arguments textarea")].map(({ value }) => value),
          code: row.querySelector(".loop-code").valueAsNumber })) };
    },
  };
}
