export function bindSessionHarnesses(find) {
  const form = find("session-harness-form"), list = find("session-harness-list");
  const remove = find("session-harness-remove"), status = find("session-harness-status");
  let profiles = [], busy = false;

  function showProvider() {
    const visible = form.elements.adapter.value === "omp";
    find("session-harness-provider").hidden = !visible;
    form.elements.provider.disabled = !visible;
  }

  function show() {
    const profile = profiles.find(({ id }) => id === list.value);
    form.elements.adapter.value = profile?.adapter ?? "omp";
    for (const field of ["name", "role", "model", "provider", "instructions"]) {
      form.elements[field].value = profile?.[field] ?? "";
    }
    remove.disabled = !profile;
    showProvider();
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
    ({ profiles } = await request());
    form.dispatchEvent(new CustomEvent("profileschange", { bubbles: true, detail: profiles }));
    list.replaceChildren(new Option("새 하네스", ""),
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
      showProvider();
      busy = false;
    }
  }

  list.onchange = () => { status.textContent = ""; show(); };
  form.elements.adapter.onchange = showProvider;
  form.onsubmit = (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const previous = profiles.find(({ id }) => id === list.value);
    void perform(async () => {
      const { profile } = await request({ ...values, id: previous?.id, version: previous?.version });
      await load(profile.id);
      status.textContent = `${profile.name} · v${profile.version} 저장됨`;
    });
  };
  remove.onclick = () => {
    const previous = profiles.find(({ id }) => id === list.value);
    if (!previous || !confirm(`‘${previous.name}’ 하네스를 삭제할까요?`)) return;
    void perform(async () => {
      await request({ remove: true, id: previous.id, version: previous.version });
      await load("");
      status.textContent = "하네스를 삭제했습니다.";
    });
  };
  return () => perform(load);
}
