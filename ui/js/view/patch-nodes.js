/* omp-live-map · view · 카드 엘리먼트 재사용 패치와 #nodes 위임 클릭 */

// pieces: [{ key, html, keep? }] — 조각마다 루트 엘리먼트는 하나다.
// 같은 key 의 마크업이 그대로면 DOM 을 건드리지 않는다. keep(자식 선택자)이 있고 그 자식의 data-sig 가
// 같으면 그 자식(큰 카드의 블록 바디)은 살려 두고 나머지 자식과 루트 속성만 갈아 끼운다.
function patchPieces(box, pieces) {
  const wanted = new Set(pieces.map((p) => p.key));
  for (const el of [...box.children]) {
    if (!wanted.has(el.dataset.pieceKey)) el.remove();
  }
  const live = new Map();
  for (const el of box.children) live.set(el.dataset.pieceKey, el);
  for (const { key, html, keep } of pieces) {
    const old = live.get(key);
    if (old && old.__html === html) continue;
    const host = document.createElement("div");
    host.innerHTML = html;
    const el = host.firstElementChild;
    if (!el) { if (old) old.remove(); continue; }
    if (old && keep && patchKeeping(old, el, keep)) { old.__html = html; continue; }
    el.dataset.pieceKey = key;
    el.__html = html;
    if (old) old.replaceWith(el); else box.appendChild(el);
  }
}

function patchKeeping(old, el, keep) {
  const kept = old.querySelector(":scope > " + keep);
  const fresh = el.querySelector(":scope > " + keep);
  if (!kept || !fresh || kept.dataset.sig !== fresh.dataset.sig) return false;
  old.className = el.className;
  old.style.cssText = el.style.cssText;
  for (const ch of [...old.children]) if (ch !== kept) ch.remove();
  let after = false;
  for (const ch of [...el.children]) {
    if (ch === fresh) { after = true; continue; }
    if (after) old.appendChild(ch); else old.insertBefore(ch, kept);
  }
  return true;
}

function onNodesClick(ev) {
  const head = ev.target.closest(".cluster .ch");
  const el = ev.target.closest(".node");
  if (!el && !head) return;
  if (Date.now() < suppressClickUntil || ev.shiftKey) return;   // 끌기 직후, Shift 다중 선택(pointerdown 에서 처리)
  if (head) {
    if (!ev.target.closest("button")) selectOnly(clusterByKey(head.parentElement.dataset.ckey));
    return;
  }
  if (el.dataset.metric) return selectOnly(clusterByKey("host:host"));
  const id = el.dataset.id || el.dataset.ghost;
  const hit = (sel) => ev.target.closest(sel);
  // 큰 카드의 미러도 실제 작은 카드다. 닫기 버튼은 동작시키고, 나머지 클릭만 선택으로 쓴다.
  if (hit("button[data-dismiss]")) return closeSession(id);
  if (el.dataset.ghost) return selectOnly(clusterOfCard(id));
  const act = hit("button[data-act]");
  if (act) return infraAction(act.dataset.act, act.dataset.t, id);
  if (hit("button[data-close]")) { closeCard(id); renderMap(false, true); return; }
  const del = hit("button[data-del]");
  if (del) return deleteLocal(del.dataset.del);
  const ren = hit("button[data-rename]");
  if (ren) { renamingId = ren.dataset.rename; renderMap(false, true); return; }
  if (el.classList.contains("big") && hit(".chrome") && chromeClick(ev.target, id)) return;
  if (hit(CARD_INTERACTIVE)) return;
  // 피그마식: 한 번 클릭은 선택, 카드 열기는 더블클릭.
  selectOnly(clusterOfCard(id));
}
