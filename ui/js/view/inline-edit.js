/* omp-live-map · view · 제자리 편집과 작은 ⋯ 메뉴. 한 맵의 띠 머리(상태 이름·예산·기간)·Task·단계 메뉴가 함께 쓴다.
   글자를 누르면 그 자리에 입력 한 칸이 열린다. Enter·포커스 이동은 저장, Esc 는 취소. 저장 버튼은 없다. */
function inlineEdit(target, { value = target.textContent, type = "text", placeholder = "", min, max, step, label, onSave }) {
  if (!target || target.__editing) return null;
  const input = document.createElement("input");
  Object.assign(input, { type, value: value ?? "", placeholder, className: "inline-edit", spellcheck: false });
  for (const [key, limit] of Object.entries({ min, max, step })) if (limit !== undefined) input[key] = limit;
  input.setAttribute("aria-label", label || placeholder || "값 고치기");
  target.__editing = true;
  target.hidden = true;
  target.after(input);
  input.focus();
  input.select?.();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    input.remove();
    target.hidden = false;
    target.__editing = false;
    if (!save || next === String(value ?? "").trim()) return;
    try { await onSave(next); } catch (error) { inlineFlash(target, error.message); }
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); void finish(true); }
    else if (event.key === "Escape") { event.preventDefault(); void finish(false); }
  });
  input.addEventListener("blur", () => void finish(true));
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  return input;
}

// 고치지 못했을 때 그 자리에 이유를 잠깐 붙인다(따로 오류 창을 띄우지 않는다).
function inlineFlash(target, message) {
  target.dataset.error = message;
  target.title = message;
  setTimeout(() => { delete target.dataset.error; }, 4000);
}

// items: [{ label, run, disabled, title }]. 바깥을 누르거나 Esc 면 닫힌다.
function inlineMenu(anchor, items) {
  closeInlineMenu();
  const menu = document.createElement("div");
  menu.className = "inline-menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const button = document.createElement("button");
    Object.assign(button, { type: "button", textContent: item.label, disabled: Boolean(item.disabled), title: item.title || "" });
    button.setAttribute("role", "menuitem");
    button.onclick = (event) => { event.stopPropagation(); closeInlineMenu(); item.run?.(); };
    menu.append(button);
  }
  document.body.append(menu);
  const box = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.min(box.bottom + 4, innerHeight - menu.offsetHeight - 8) + "px";
  setTimeout(() => {
    document.addEventListener("pointerdown", inlineMenuOutside, true);
    document.addEventListener("keydown", inlineMenuKey, true);
  });
  menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  return menu;
}
function inlineMenuOutside(event) { if (!event.target.closest?.(".inline-menu")) closeInlineMenu(); }
function inlineMenuKey(event) { if (event.key === "Escape") { event.stopPropagation(); closeInlineMenu(); } }
function closeInlineMenu() {
  document.querySelector(".inline-menu")?.remove();
  document.removeEventListener("pointerdown", inlineMenuOutside, true);
  document.removeEventListener("keydown", inlineMenuKey, true);
}
