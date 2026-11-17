/* omp-live-map · view · 카드 하이라이트(답변 완료 · 선택 필요) 클래스 토글 */

// patchPieces 로 카드가 갈아 끼워져도 마크업은 그대로이므로, 카드 루트의 클래스만 매번 다시 맞춘다.
// 배지 글자는 CSS(::before)가 클래스에 따라 그리므로 DOM 을 만들지 않는다.
function paintAttention() {
  const box = $("nodes");
  if (!box) return;
  for (const el of box.querySelectorAll(".node")) {
    const id = el.dataset.id || el.dataset.ghost || "";
    const rec = id ? ATTN.get(id) : null;
    const kind = rec ? rec.kind : "";
    el.classList.toggle("attn-done", kind === "done");
    el.classList.toggle("attn-ask", kind === "ask");
  }
  if (typeof paintMinimap === "function") paintMinimap();
}
