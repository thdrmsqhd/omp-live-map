import { loadModelOptions, modelKey, showModelOptions } from "./engineering-model-options.js";

export function bindSessionHarnesses(find) {
  const form = find("session-harness-form"), list = find("session-harness-list");
  const remove = find("session-harness-remove"), status = find("session-harness-status");
  const hint = find("session-harness-model-hint");
  let profiles = [], catalog = { omp: [], claude: [] }, busy = false;

  function showModels(profile) {
    const adapter = form.elements.adapter.value;
    const saved = profiles.filter((item) => item.adapter === adapter && item.model)
      .map(({ provider, model }) => ({ provider, id: model, name: model }));
    const models = [...catalog[adapter], ...saved].map((model) => adapter === "claude" ? { ...model, provider: "" } : model);
    const key = profile?.adapter === adapter ? modelKey(profile.provider, profile.model) : "";
    showModelOptions(form.elements.model, models, key, "실행기 기본 모델");
    hint.hidden = adapter !== "omp" || catalog.omp.length > 0;
    hint.textContent = "OMP 모델 목록을 불러오려면 관측 화면에서 OMP 세션을 연 뒤 프로필을 다시 열어 주세요.";
  }

  function show() {
    const profile = profiles.find(({ id }) => id === list.value);
    form.elements.adapter.value = profile?.adapter ?? "omp";
    for (const field of ["name", "role", "instructions"]) {
      form.elements[field].value = profile?.[field] ?? "";
    }
    remove.disabled = !profile;
    showModels(profile);
  }

  async function request(input) {
    const response = await fetch("/api/session-harnesses", input === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("하네스 요청 실패 (" + response.status + ")");
    const result = await response.json();
    if (!result.ok) throw new Error(result.out);
    return result;
  }

  async function load(id = list.value) {
    const [result, models] = await Promise.all([request(), loadModelOptions(true)]);
    profiles = result.profiles;
    catalog = models;
    form.dispatchEvent(new CustomEvent("profileschange", { bubbles: true, detail: profiles }));
    list.replaceChildren(new Option("새 프로필", ""),
      ...profiles.map((profile) => new Option(`${profile.name} · v${profile.version}`, profile.id)));
    list.value = profiles.some((profile) => profile.id === id) ? id : "";
    show();
  }

  async function perform(work) {
    if (busy) return;
    busy = true;
    status.textContent = "";
    const controls = [...form.elements].filter((element) => !element.disabled);
    for (const element of controls) element.disabled = true;
    try { await work(); }
    catch (error) { status.textContent = error.message; }
    finally {
      for (const element of controls) element.disabled = false;
      remove.disabled = !list.value;
      busy = false;
    }
  }

  list.onchange = () => { status.textContent = ""; show(); };
  form.elements.adapter.onchange = () => showModels(profiles.find(({ id }) => id === list.value));
  form.onsubmit = (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    [values.provider, values.model] = values.model ? JSON.parse(values.model) : ["", ""];
    const previous = profiles.find(({ id }) => id === list.value);
    void perform(async () => {
      const { profile } = await request({ ...values, id: previous?.id, version: previous?.version });
      await load(profile.id);
      status.textContent = `${profile.name} · v${profile.version} 저장됨`;
    });
  };
  remove.onclick = () => {
    const previous = profiles.find(({ id }) => id === list.value);
    if (!previous || !confirm(`‘${previous.name}’ 프로필을 삭제할까요?`)) return;
    void perform(async () => {
      await request({ remove: true, id: previous.id, version: previous.version });
      await load("");
      status.textContent = "프로필을 삭제했습니다.";
    });
  };
  return (id) => perform(() => load(id));
}
