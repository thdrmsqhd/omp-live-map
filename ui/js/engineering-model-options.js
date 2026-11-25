export const modelKey = (provider, id) => id ? JSON.stringify([provider ?? "", id]) : "";

export function showModelOptions(select, models, selected, placeholder) {
  const choices = new Map();
  for (const { provider, id, name } of models) {
    const key = modelKey(provider, id);
    if (!choices.has(key)) choices.set(key, provider ? `${name} · ${provider}` : name);
  }
  if (selected && !choices.has(selected)) {
    const [provider, id] = JSON.parse(selected);
    choices.set(selected, `${[id, provider].filter(Boolean).join(" · ")} (저장된 모델)`);
  }
  select.replaceChildren(new Option(placeholder, ""), ...[...choices].map(([key, name]) => new Option(name, key)));
  select.value = selected;
}

let shared;
export function loadModelOptions(includeOmp = false) {
  if (!includeOmp && shared) return shared;
  const result = fetch("/api/session/model-options" + (includeOmp ? "?omp=1" : "")).then((response) => {
    if (!response.ok) throw new Error("모델 목록을 가져오지 못했습니다.");
    return response.json();
  });
  if (!includeOmp) {
    shared = result;
    result.catch(() => { shared = null; });
  }
  return result;
}
