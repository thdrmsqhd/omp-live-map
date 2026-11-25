function line(parent, text) {
  const item = document.createElement("li");
  item.textContent = text;
  parent.append(item);
}

export function harnessProvenance(definitions, attempts) {
  if (!definitions) return null;
  const { harness, model } = definitions;
  const panel = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = harness.name + " v" + harness.version + " · " + model.name + " v" + model.version;
  const items = document.createElement("ul");
  line(items, harness.adapter + " · " + model.provider + "/" + model.model);
  for (const attempt of attempts) {
    const details = [
      "세션 " + (attempt.sessionId ?? "미수집"),
      attempt.tools ? (attempt.tools.length ? "도구 " + attempt.tools.join(", ") : "도구 호출 기록 없음") : "도구 기록 미수집",
    ];
    line(items, details.join(" · "));
    for (const source of attempt.sources ?? []) {
      line(items, "입력 " + source.path + " · SHA-256 " + source.sha256);
    }
  }
  panel.append(summary, items);
  return panel;
}
