const sections = { role: "역할", instructions: "작업 지시", assets: "프로젝트 규칙과 스킬", result: "결과 형식" };

function element(tag, text) {
  const result = document.createElement(tag);
  result.textContent = text;
  return result;
}

export function bindHarnessPreview({ find, request, payload, project, saved }) {
  const panel = find("harness-preview");
  const status = find("harness-preview-status");
  const openDraft = find("harness-preview-open");
  const openSaved = find("harness-preview-saved");
  let revision = 0;

  function reset() {
    revision += 1;
    status.textContent = "";
    panel.hidden = true;
    openDraft.disabled = !project();
    openSaved.disabled = !project() || !saved();
  }

  function render({ profile, model, prompt, policy, ready, blockedReason, sources, workflowInputs }) {
    const settings = [
      ["대상", profile.version ? profile.name + " v" + profile.version : profile.name + " · 초안"],
      ["실행기", profile.adapter === "claude" ? "Claude Code" : "OMP"],
      ["모델", model.name + " v" + model.version + " · " + model.provider + "/" + model.id],
    ];
    if (model.reasoning) settings.push(["추론 수준", model.reasoning]);
    if (policy) {
      settings.push(["작업 폴더", "관리되는 Git worktree (" + policy.directory + ")"]);
      settings.push(["런타임에서 강제하는 범위", "작업 폴더 내 쓰기 허용 · 네트워크 격리"]);
      settings.push(["사용 도구", policy.tools.join(", ")]);
    }
    for (const source of sources) settings.push(["저장소 자료", source.path + " · " + source.commit.slice(0, 12) + " · SHA-256 " + source.sha256]);
    if (workflowInputs.length) settings.push(["Workflow에서 연결할 입력", workflowInputs.join(", ")]);
    settings.push(["MCP·Hooks", "초안 저장 · 실행 미지원"]);
    find("harness-preview-settings").replaceChildren(...settings.flatMap(([label, value]) => [
      element("dt", label), element("dd", value),
    ]));
    find("harness-preview-prompt").replaceChildren(...prompt.map(({ name, path, text }) => {
      const line = element("li", path ?? sections[name] ?? name);
      line.append(element("pre", text));
      return line;
    }));
    status.textContent = ready ? "실행 준비 완료" : "현재 실행할 수 없습니다. " + blockedReason;
    panel.hidden = false;
  }

  async function preview(useSaved) {
    const current = ++revision;
    status.textContent = "적용값을 확인하는 중입니다.";
    panel.hidden = true;
    try {
      const query = useSaved ? saved() : { payload: payload() };
      const result = await request("harness/preview", {}, { ...query, project: project() });
      if (revision === current) render(result);
    } catch (error) {
      if (revision === current) status.textContent = error.message;
    }
  }

  openDraft.addEventListener("click", () => preview(false));
  openSaved.addEventListener("click", () => preview(true));
  const fields = find("harness-fields");
  fields.addEventListener("input", reset);
  fields.addEventListener("click", (event) => {
    if (event.target.tagName === "BUTTON" && !event.target.closest("#harness-preview")) {
      if (event.target !== openDraft && event.target !== openSaved) reset();
    }
  });
  return { reset };
}
