/* omp-live-map · view · 새 세션 창 (작업 폴더 + 첫 지시로 맵이 omp 세션을 띄운다) */

function closeNewSession() {
  const box = $("newsess");
  if (!box) return;
  document.removeEventListener("keydown", box.__key, true);
  clearAttachments(box.__files);
  box.remove();
}

// at: 우클릭한 지도 좌표 { x, y }. 주면 새 세션 카드를 그 자리에 놓는다.
function openNewSession(at) {
  closeNewSession();
  const box = document.createElement("div");
  box.id = "newsess";
  box.innerHTML = `<div class="nsbox">
    <div class="nst">새 세션</div>
    <label>하네스<select class="nsdef">
      <option value="">하네스 없이 · 실행기 기본 설정</option>
    </select></label>
    <div class="nsharness-tools">
      <small class="nsdef-note" role="status"></small>
      <a href="/?mode=design">하네스 관리(설계)</a>
    </div>
    <label>실행기<select class="nshz">
      <option value="omp">omp (기본)</option>
      <option value="claude">Claude Code</option>
    </select></label>
    <label>작업 폴더<input class="nscwd" spellcheck="false"></label>
    <label>첫 지시<textarea class="nstext" rows="4" placeholder="에이전트에 줄 첫 지시 (Ctrl+Enter · 이미지·파일 붙여넣기/끌어 놓기)"></textarea></label>
    <div class="achips"></div>
    <div class="nserr"></div>
    <div class="nsrow"><button data-cancel="1">취소</button><button class="go" data-open="1">열기</button></div>
  </div>`;
  const cwd = box.querySelector(".nscwd");
  const ta = box.querySelector(".nstext");
  const err = box.querySelector(".nserr");
  const hz = box.querySelector(".nshz");
  // 하네스(설계 탭의 하네스 정의)를 고르면 그 역할·지시가 세션의 시스템 프롬프트가 되고 실행기·모델도 하네스를 따른다.
  const defSelect = box.querySelector(".nsdef");
  const defNote = box.querySelector(".nsdef-note");
  let harnesses = [];
  const selectedHarness = () => harnesses.find(({ id }) => id === defSelect.value);
  const scopeOf = ({ scope, team }) => scope === "team" ? "팀 " + team : scope === "project" ? "프로젝트" : "개인";
  const paintHarness = () => {
    const selected = selectedHarness();
    hz.disabled = Boolean(selected);
    hz.value = selected?.adapter ?? (NEW_HARNESS === "claude" ? "claude" : "omp");
    defNote.textContent = selected ? [selected.role, selected.modelName || selected.model].filter(Boolean).join(" · ") : "";
  };
  async function loadHarnesses() {
    try {
      const response = await fetch("/api/session-harnesses");
      const result = await response.json();
      if (!result.ok) throw new Error(result.out);
      harnesses = result.harnesses;
      defSelect.replaceChildren(new Option("하네스 없이 · 실행기 기본 설정", ""),
        ...harnesses.map((item) => new Option(`${item.name} · ${item.adapter === "omp" ? "OMP" : "Claude Code"} · ${scopeOf(item)} · v${item.version}`, item.id)));
      paintHarness();
      if (!harnesses.length) defNote.textContent = "저장된 하네스가 없습니다. 설계 탭에서 '기본 구성 추가'로 만들 수 있습니다.";
    } catch (error) {
      defNote.textContent = "하네스를 불러오지 못했습니다. " + error.message;
    }
  }
  const go = box.querySelector("button[data-open]");
  hz.value = NEW_HARNESS === "claude" ? "claude" : "omp";
  hz.addEventListener("change", () => saveNewHarness(hz.value));
  defSelect.addEventListener("change", paintHarness);
  cwd.value = ENV.localCwd || "";
  installCwdSuggest(box, cwd);
  const files = box.__files = [];
  const chips = box.querySelector(".achips");
  wireAttach(box, () => files, () => paintAttachChips(chips, files));

  const submit = async () => {
    const text = ta.value.trim();
    // 첫 지시와 첨부가 모두 비면 보내지 않는다.
    if (!text && !files.length) { ta.focus(); return; }
    const bad = attachProblem(files);
    if (bad) { err.textContent = bad; return; }
    if (go.disabled) return;
    go.disabled = true;
    go.textContent = "여는 중…";
    err.textContent = "";
    // 카드가 아직 없으므로 요청한 지도 좌표(없으면 화면 중앙)에 '여는 중' 자리표시를 띄운다.
    const pend = addPending(at, cwd.value.trim());
    let out;
    try {
      const selected = selectedHarness();
      const definition = selected && { id: selected.id, version: selected.version };
      const res = await postJSON("/api/session/new", { cwd: cwd.value.trim(), text,
        files: attachPayload(files), harness: hz.value, definition });
      out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
    } catch (e) {
      out = { ok: false, out: e.message };
    }
    settlePending(pend, out);
    // 기다리는 사이 창을 닫았으면 결과를 그릴 곳이 없다(자리표시가 오류를 보여 준다).
    if (!box.isConnected) return;
    if (out.ok) {
      rememberCwd(cwd.value.trim());
      // 스냅샷이 응답보다 먼저 와서 카드가 자동 자리에 그려졌을 수 있으므로 바로 다시 그린다.
      if (at && out.node) { MANUAL["card:" + out.node] = { x: at.x, y: at.y }; saveManual(); renderMap(false, true); }
      closeNewSession();
      return;
    }
    go.disabled = false;
    go.textContent = "열기";
    err.textContent = out.out || "세션을 열지 못했습니다";
  };

  // 캡처 단계에서 받아 카드 닫기 같은 전역 단축키보다 먼저 처리한다.
  box.__key = (e) => {
    // 열린 폴더 자동완성이 먹은 키(↑↓·Tab·Enter·Escape)는 창 조작으로 넘기지 않는다.
    if (box.__sugKey && box.__sugKey(e)) return;
    const send = e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (e.key !== "Escape" && !send) return;
    e.preventDefault();
    e.stopPropagation();
    if (send) submit(); else closeNewSession();
  };
  document.addEventListener("keydown", box.__key, true);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.open) submit(); else if (b.dataset.cancel) closeNewSession();
  });
  // 창 안의 우클릭이 맵 메뉴를 띄우지 않게 한다.
  box.addEventListener("contextmenu", (e) => e.stopPropagation());
  document.body.appendChild(box);
  void loadHarnesses();
  (cwd.value ? ta : cwd).focus();
}
