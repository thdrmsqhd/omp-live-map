// 설계 모드의 바로 실행: 할 일(템플릿) → 한 줄 목표 → 실행. 작업 폴더는 앱이 정하고(가장 최근 세션의 폴더), 바꿀 때만 목록에서 고른다.
// 폴더 등록과 기본 구성은 실행할 때 앱이 조용히 한다. 모든 단계는 기존 Engineering API 만 쓴다(폴더 대화상자 결과는 desktop/main.cjs 가 한 번만 등록을 허용한다).
const DISMISS_KEY = "omp-first-run-dismissed";
// 마지막으로 보인 상태를 기억해 다음 로드에서 응답을 기다리지 않고 같은 자리를 잡는다(늦게 나타나 캔버스를 밀지 않게).
const VISIBLE_KEY = "omp-first-run-visible";
// 실행 창(view/workflow-launch.js)의 완료 조건 기본 문장과 같다.
export const QUICK_ACCEPTANCE = "작업 목표를 끝내고, 기존 기능과 테스트가 깨지지 않는다.";

// 템플릿이 필요로 하는 역할만 기본 구성에서 골라 { 역할: { id, version } } 로 돌려준다. 루프는 템플릿 전용이 있으면 그것을 쓴다.
export function quickRefs(preset, defaults, definitions) {
  const ids = { author: defaults.author, reviewer: defaults.reviewer, triage: defaults.triage, loop: defaults.loops?.[preset.id] ?? defaults.loop };
  return Object.fromEntries(Object.entries(ids).filter(([role]) => preset[role])
    .map(([role, id]) => [role, { id, version: definitions.find((entry) => entry.id === id)?.version }]));
}

// 대상 폴더 후보와 기본 선택을 정한다: 요청한 폴더 → 최근 세션 → 마지막으로 쓴 폴더 → 보관되지 않은 프로젝트 순.
export function quickFolders({ sessions = [], projects = [], preferred = "", remembered = "" }) {
  const seen = new Set();
  const folders = [preferred, ...sessions, remembered, ...projects.filter(({ archived }) => !archived).map(({ root }) => root)].filter((folder) => {
    const key = String(folder || "").toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { folders, chosen: folders[0] ?? "" };
}

export function bindFirstRun({ find, request, reloadProjects, openWorkflow }) {
  const panel = find("first-run");
  const list = find("first-run-steps");
  const note = find("first-run-status");
  let busy = false;
  const show = (visible) => {
    if (panel) panel.hidden = !visible;
    try { localStorage.setItem(VISIBLE_KEY, visible ? "1" : "0"); } catch {}
  };
  // 처음 여는 사용자는 안내가 보이는 쪽으로 자리를 잡는다. 이미 끝낸 사용자는 숨긴 채로 시작한다.
  if (panel) panel.hidden = localStorage.getItem(DISMISS_KEY) === "1" || localStorage.getItem(VISIBLE_KEY) === "0";

  const say = (text) => { note.textContent = text; };
  const button = (label, action) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.onclick = async () => {
      if (busy) return;
      busy = true;
      element.disabled = true;
      say("");
      try { await action(); } catch (error) { say(error.message); }
      finally { busy = false; await refresh(); }
    };
    return element;
  };
  const link = (label, href) => Object.assign(document.createElement("a"), { textContent: label, href });

  const RUNTIME_HINT = "Docker Desktop과 Claude Code 로그인 또는 API 키가 필요합니다.";
  // 다시 그려도 고른 할 일과 입력한 목표가 남도록 입력 요소는 한 번만 만들어 계속 쓴다.
  const goalInput = Object.assign(document.createElement("textarea"), {
    rows: 2, maxLength: 8000, placeholder: "무엇을 할까요? 예: 로그인 버튼을 눌러도 반응이 없어요. 원인을 찾아 고쳐 주세요.",
  });
  goalInput.setAttribute("aria-label", "작업 목표");
  // 작업 폴더 목록도 한 번만 만들고 옵션만 갈아 끼운다(포커스·선택 유지).
  const folderSelect = document.createElement("select");
  folderSelect.setAttribute("aria-label", "작업 폴더");
  const folderField = Object.assign(document.createElement("label"), { className: "first-run-folder" });
  folderField.append("작업 폴더 ", folderSelect);
  let selected = "bugfix";
  let runButton = null;
  // 세션 카드 메뉴나 목록에서 고른 폴더. 다시 그려도 유지한다.
  let preferred = "";
  const folderValue = () => (folderSelect.value === "pick:" ? "" : folderSelect.value);
  const canRun = () => Boolean(folderValue()) && goalInput.value.trim().length > 0;
  goalInput.addEventListener("input", () => { if (runButton) runButton.disabled = busy || !canRun(); });

  const column = (title, ...children) => {
    const box = document.createElement("div");
    box.className = "first-run-col";
    const head = document.createElement("strong");
    head.textContent = title;
    box.append(head, ...children);
    return box;
  };
  const text = (tag, content, className) => Object.assign(document.createElement(tag), { textContent: content, className: className ?? "" });
  const folderName = (folder) => folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;
  // 대화상자에서 받은 경로는 한 번만 등록할 수 있으므로 고르는 즉시 등록한다. 취소하면 다시 그리면서 이전 선택으로 돌아간다.
  folderSelect.addEventListener("change", async () => {
    if (folderSelect.value !== "pick:") {
      preferred = folderSelect.value;
      if (runButton) runButton.disabled = busy || !canRun();
      return;
    }
    if (busy) return;
    busy = true;
    say("");
    try {
      const picked = await window.engineeringDesktop.pickFolder();
      if (!picked.ok) throw new Error(picked.error || "폴더를 고르지 않았습니다.");
      const saved = await request("projects/register-picked", {}, { root: picked.value });
      preferred = picked.value;
      await reloadProjects(saved.id);
    } catch (error) { say(error.message); }
    finally { busy = false; await refresh(); }
  });

  async function launch(root, preset) {
    const goal = goalInput.value.trim();
    const runtime = await request("runtime").catch(() => null);
    if (runtime?.status !== "ready") throw new Error(runtime?.detail || RUNTIME_HINT);
    // 폴더가 프로젝트로 등록돼 있지 않으면 여기서 등록한다. 이미 있으면 그대로 돌려주므로 실행할 때마다 불러도 된다.
    const project = await request("projects/ensure", {}, { root });
    const defaults = await request("workflows/presets/defaults", {}, { scope: "personal" });
    const definitions = await request("definitions", { project: project.id });
    const run = await request("workflows/launch", {}, { project: project.id, preset: preset.id, refs: quickRefs(preset, defaults, definitions),
      goal, acceptance: QUICK_ACCEPTANCE, title: goal.split(/\r?\n/)[0].slice(0, 240), timeoutMs: 20 * 60000, budgetCents: 6000, key: crypto.randomUUID() });
    // 새로 생긴 기본 구성이 캔버스에 보이게 다시 읽는다.
    await reloadProjects(project.id);
    try { localStorage.setItem("omp-quick-folder", root); } catch {}
    goalInput.value = "";
    if (typeof window.openMapWorkflow === "function") void window.openMapWorkflow(run.id, undefined, { design: true });
    say("실행을 시작했습니다. 진행은 아래 실행 내역에서 봅니다.");
  }

  async function refresh() {
    if (!panel) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") { show(false); return; }
    let runtime, presets, projects;
    try {
      [runtime, presets, projects] = await Promise.all([request("runtime").catch(() => null), request("workflows/presets"), request("projects")]);
    } catch (error) { say(error.message); return; }
    let remembered = "";
    try { remembered = localStorage.getItem("omp-quick-folder") ?? ""; } catch {}
    const { folders, chosen } = quickFolders({ sessions: typeof cwdSessions === "function" ? cwdSessions() : [], projects, preferred, remembered });
    if (!presets.some(({ id }) => id === selected)) selected = presets[0]?.id;
    const ready = runtime?.status === "ready";

    const parts = [];
    // 실행 환경 경고는 늘 있는 제목 줄에 둔다. 패널 높이가 바뀌면 아래 캔버스가 밀려 열린 메뉴가 닫히거나 끌기가 빗나간다.
    panel.querySelector(".first-run-warn")?.remove();
    if (!ready) {
      const warn = text("p", (runtime?.detail || RUNTIME_HINT) + " ", "first-run-warn");
      warn.append(link("설정에서 준비", "/engineering.html"));
      find("first-run-dismiss").before(warn);
    }

    const options = folders.map((folder) => Object.assign(new Option(folderName(folder) + " · " + folder, folder), { title: folder }));
    if (!folders.length) options.push(new Option("폴더를 고르세요", ""));
    if (window.engineeringDesktop?.pickFolder) options.push(new Option("다른 폴더…", "pick:"));
    folderSelect.replaceChildren(...options);
    folderSelect.value = chosen;

    const row = document.createElement("div");
    row.className = "first-run-presets";
    for (const preset of presets) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.setAttribute("aria-pressed", String(preset.id === selected));
      choice.append(text("strong", preset.name), text("small", preset.summary ?? ""));
      choice.onclick = () => {
        selected = preset.id;
        for (const other of row.children) other.setAttribute("aria-pressed", String(other === choice));
      };
      row.append(choice);
    }

    runButton = button("실행", async () => {
      const preset = presets.find(({ id }) => id === selected);
      const root = folderValue();
      if (!root || !preset) throw new Error("폴더와 할 일을 고르세요.");
      await launch(root, preset);
    });
    runButton.className = "workflow-primary";
    runButton.disabled = !canRun();
    parts.push(column("① 할 일", row), column("② 무엇을 할까요", folderField, goalInput, runButton),
      text("p", "작업 폴더는 가장 최근 세션의 폴더로 정해집니다. 세션 카드 메뉴의 ‘이 폴더에서 Workflow 실행’으로도 열 수 있습니다. 하네스·루프는 할 일에 맞게 고릅니다.", "first-run-hint"));
    list.replaceChildren(...parts);
    // 이 패널이 늘 쓰는 입구이므로 안내 닫기를 누르지 않았으면 계속 보인다.
    show(true);
    panel.dataset.complete = ready && chosen ? "1" : "";
  }

  // 세션 카드 메뉴 같은 바깥에서 그 폴더로 패널을 연다.
  window.ompQuickRun = {
    async target(root) {
      try { localStorage.removeItem(DISMISS_KEY); } catch {}
      preferred = root;
      await refresh();
      goalInput.focus();
    },
  };

  find("first-run-dismiss")?.addEventListener("click", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    show(false);
  });
  return { refresh };
}
