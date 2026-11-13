/* omp-live-map · view · 새 세션 창 (작업 폴더 + 첫 지시로 맵이 omp 세션을 띄운다) */

function closeNewSession() {
  const box = $("newsess");
  if (!box) return;
  document.removeEventListener("keydown", box.__key, true);
  box.remove();
}

function openNewSession() {
  closeNewSession();
  const box = document.createElement("div");
  box.id = "newsess";
  box.innerHTML = `<div class="nsbox">
    <div class="nst">새 세션</div>
    <label>작업 폴더<input class="nscwd" spellcheck="false"></label>
    <label>첫 지시<textarea class="nstext" rows="4" placeholder="에이전트에 줄 첫 지시 (Ctrl+Enter)"></textarea></label>
    <div class="nserr"></div>
    <div class="nsrow"><button data-cancel="1">취소</button><button class="go" data-open="1">열기</button></div>
  </div>`;
  const cwd = box.querySelector(".nscwd");
  const ta = box.querySelector(".nstext");
  const err = box.querySelector(".nserr");
  const go = box.querySelector("button[data-open]");
  cwd.value = ENV.localCwd || "";

  const submit = async () => {
    const text = ta.value.trim();
    // 첫 지시가 비면 보내지 않는다.
    if (!text) { ta.focus(); return; }
    if (go.disabled) return;
    go.disabled = true;
    go.textContent = "여는 중…";
    err.textContent = "";
    let out;
    try {
      const res = await postJSON("/api/session/new", { cwd: cwd.value.trim(), text });
      out = await res.json().catch(() => ({ ok: false, out: "HTTP " + res.status }));
    } catch (e) {
      out = { ok: false, out: e.message };
    }
    // 기다리는 사이 창을 닫았으면 결과를 그릴 곳이 없다.
    if (!box.isConnected) return;
    if (out.ok) { closeNewSession(); return; }
    go.disabled = false;
    go.textContent = "열기";
    err.textContent = out.out || "세션을 열지 못했습니다";
  };

  // 캡처 단계에서 받아 카드 닫기 같은 전역 단축키보다 먼저 처리한다.
  box.__key = (e) => {
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
  (cwd.value ? ta : cwd).focus();
}
