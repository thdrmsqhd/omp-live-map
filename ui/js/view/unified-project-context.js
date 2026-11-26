/* Project document context for the unified Live Map. */
(() => {
  "use strict";

  const categories = [
    ["purpose", "프로젝트 목적", "목적을 요약할 문서가 없습니다."],
    ["progress", "진행 현황", "진행 현황이 기록된 문서가 없습니다."],
    ["decisions", "주요 결정", "기록된 결정을 찾지 못했습니다."],
  ];
  const refreshMs = 5000;
  let panel;

  function node(tag, label, className) {
    const element = document.createElement(tag);
    if (label) element.textContent = label;
    if (className) element.className = "project-context-" + className;
    return element;
  }
  function status(element, label) {
    if (element.textContent !== label) element.textContent = label;
    element.hidden = !label;
  }
  async function request(project, source) {
    const params = { context: "1", project };
    if (source !== undefined) params.source = source;
    const result = await window.engineeringDesktop.request("projects", params);
    if (!result?.ok) throw new Error("Project context request failed");
    return result.value;
  }
  function visible(view) {
    return panel === view && !document.hidden && !view.root.hidden && view.root.getClientRects().length > 0;
  }
  function link(view, label, id, line) {
    const a = node("a", label, "source-link");
    a.href = "#unified-project-context-source";
    a.title = line ? `${id}:${line}` : id;
    a.addEventListener("click", (event) => {
      event.preventDefault();
      void openSource(view, id, line, true, a);
    });
    return a;
  }
  function paint(view, data) {
    view.title.textContent = data.project.name;
    const sections = categories.map(([kind, name, empty]) => {
      const section = node("section", "", "section");
      section.append(node("h3", name));
      const items = data.summary[kind] ?? [];
      if (!items.length) section.append(node("p", empty, "empty"));
      for (const item of items) {
        const block = node("div", "", "excerpt");
        block.append(node("p", item.text), link(view, `${item.source}:${item.line}${item.heading ? " · " + item.heading : ""}`, item.source, item.line));
        section.append(block);
      }
      return section;
    });
    const sources = node("section", "", "sources");
    sources.append(node("h3", "출처 문서"));
    if (!data.sources.length) sources.append(node("p", "이 프로젝트에서 읽을 수 있는 문서를 찾지 못했습니다.", "empty"));
    else {
      const list = node("ul");
      for (const source of data.sources) {
        const item = node("li");
        item.append(link(view, source.id === source.title ? source.id : `${source.title} · ${source.id}`, source.id));
        list.append(item);
      }
      sources.append(list);
    }
    view.body.replaceChildren(...sections, sources);
  }
  async function openSource(view, id, line, focus = false, trigger) {
    if (panel !== view) return;
    const previous = view.source;
    const source = { id, line, trigger: trigger ?? previous?.trigger, version: focus ? undefined : previous?.version, pending: true };
    view.source = source;
    view.preview.hidden = false;
    if (focus) {
      view.sourceTitle.textContent = id;
      view.sourceText.replaceChildren();
      status(view.sourceStatus, "원문을 읽는 중…");
      view.sourceTitle.focus();
    }
    try {
      const doc = await request(view.project, id);
      if (panel !== view || view.source !== source) return;
      if (typeof doc?.text !== "string" || doc.id !== id) throw new Error("Invalid project source");
      source.version = doc.version;
      view.sourceTitle.textContent = line ? `${id}:${line}` : id;
      status(view.sourceStatus, doc.truncated ? "파일 앞부분만 표시합니다 (32KB)." : "");
      if (!line) { view.sourceText.textContent = doc.text; return; }
      const lines = doc.text.split(/\r?\n/);
      const mark = node("mark", lines[line - 1] ?? "");
      view.sourceText.replaceChildren(lines.slice(0, line - 1).join("\n") + (line > 1 ? "\n" : ""), mark,
        line < lines.length ? "\n" + lines.slice(line).join("\n") : "");
      if (focus) mark.scrollIntoView({ block: "nearest" });
    } catch {
      if (panel !== view || view.source !== source) return;
      source.version = undefined;
      view.sourceText.replaceChildren();
      status(view.sourceStatus, "이 문서를 읽을 수 없습니다.");
    } finally { source.pending = false; }
  }
  async function refresh(view) {
    if (!visible(view) || !view.project || !window.engineeringDesktop?.request || view.loading) return;
    view.loading = true;
    try {
      const data = await request(view.project);
      if (panel !== view) return;
      if (data?.project?.id !== view.project || !data.summary || !Array.isArray(data.sources)) throw new Error("Invalid project context");
      const signature = JSON.stringify(data);
      if (signature !== view.signature) {
        paint(view, data);
        view.signature = signature;
      }
      status(view.status, "");
      const selected = view.source;
      if (!selected || selected.pending) return;
      const current = data.sources.find(({ id }) => id === selected.id);
      if (!current) {
        view.source = { ...selected, version: undefined };
        view.sourceText.replaceChildren();
        status(view.sourceStatus, "이 문서를 더 이상 읽을 수 없습니다.");
      } else if (selected.version !== current.version) {
        void openSource(view, selected.id, selected.line);
      }
    } catch {
      if (panel === view) status(view.status, view.signature ? "문서 갱신에 실패했습니다. 마지막으로 읽은 내용을 표시합니다." : "프로젝트 문서를 불러오지 못했습니다.");
    } finally { view.loading = false; }
  }
  function hide() {
    if (!panel) return;
    window.clearInterval(panel.timer);
    panel.root.hidden = true;
    panel.root.replaceChildren();
    panel = undefined;
  }
  function show(projectId) {
    const root = document.getElementById("unified-project-context");
    if (!root) return;
    const project = typeof projectId === "string" && projectId ? projectId : null;
    if (panel?.root === root && panel.project === project) {
      root.hidden = false;
      if (!panel.signature) void refresh(panel);
      return;
    }
    hide();
    const view = { root, project };
    panel = view;
    const header = node("header", "", "header");
    view.title = node("h2", "프로젝트 문서", "title");
    view.title.tabIndex = -1;
    header.append(view.title);
    view.status = node("p", "", "status");
    view.status.setAttribute("role", "status");
    view.body = node("div", "", "body");
    view.preview = node("section", "", "preview");
    view.preview.id = "unified-project-context-source";
    view.preview.hidden = true;
    view.sourceTitle = node("h3");
    view.sourceTitle.tabIndex = -1;
    const closePreview = node("button", "원문 닫기");
    closePreview.type = "button";
    closePreview.addEventListener("click", () => {
      const trigger = view.source?.trigger;
      view.source = undefined;
      view.preview.hidden = true;
      view.sourceText.replaceChildren();
      if (trigger?.isConnected) trigger.focus();
      else view.title.focus();
    });
    view.sourceStatus = node("p", "", "status");
    view.sourceStatus.setAttribute("role", "status");
    view.sourceText = node("pre", "", "source-text");
    view.preview.append(view.sourceTitle, closePreview, view.sourceStatus, view.sourceText);
    root.replaceChildren(header, view.status, view.body, view.preview);
    root.hidden = false;
    if (!project) status(view.status, "프로젝트를 선택하면 문서를 볼 수 있습니다.");
    else if (!window.engineeringDesktop?.request) status(view.status, "프로젝트 문서는 데스크톱 앱에서 볼 수 있습니다.");
    else {
      status(view.status, "프로젝트 문서를 읽는 중…");
      view.timer = window.setInterval(() => void refresh(view), refreshMs);
      void refresh(view);
    }
  }
  document.addEventListener("visibilitychange", () => { if (panel) void refresh(panel); });
  window.UnifiedProjectContext = { show, hide };
})();
